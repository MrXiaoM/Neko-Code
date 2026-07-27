"""Service runtime coordinating HTTP, lease expiry, discovery, and tray UI."""

from __future__ import annotations

import logging
import os
import secrets
import socket
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from threading import Event, Thread

import uvicorn

from . import DEFAULT_HEARTBEAT_INTERVAL_SECONDS, DEFAULT_LEASE_TTL_SECONDS
from .api import ApiContext, create_app
from .discovery import DataDirectoryLock, DiscoveryFile, DiscoveryInfo
from .focus import FocusDispatcher
from .store import ApprovalStore
from .tray import NullTray, WindowsTray, create_tray

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class RuntimeConfig:
    data_dir: Path
    lease_ttl_seconds: float = DEFAULT_LEASE_TTL_SECONDS
    heartbeat_interval_seconds: float = DEFAULT_HEARTBEAT_INTERVAL_SECONDS
    headless: bool = False


class ServiceRuntime:
    """Run one authenticated notifier instance for a configured data directory."""

    def __init__(self, config: RuntimeConfig) -> None:
        self.config = config
        self.instance_id = secrets.token_hex(16)
        self.token = secrets.token_urlsafe(48)
        self._lock = DataDirectoryLock(config.data_dir)
        self._discovery = DiscoveryFile(config.data_dir)
        self._stop_event = Event()
        self._server: uvicorn.Server | None = None
        self._server_thread: Thread | None = None
        self._pruner_thread: Thread | None = None
        self._socket: socket.socket | None = None
        self._tray: WindowsTray | NullTray | None = None
        self.store = ApprovalStore(ttl_seconds=config.lease_ttl_seconds, on_change=self._on_count_changed)
        self.focus_dispatcher = FocusDispatcher(self.store)

    def run(self) -> None:
        """Run until the tray closes or an interrupt asks the process to stop."""
        if not self.config.headless and os.name != "nt":
            raise RuntimeError("neko-notifier tray mode requires Windows")
        self._lock.acquire()
        try:
            self._start_components()
            assert self._tray is not None
            self._tray.run()
        except KeyboardInterrupt:
            logger.info("shutdown requested by keyboard interrupt")
        finally:
            self.stop()
            self._lock.release()

    def stop(self) -> None:
        """Idempotently stop publishing, HTTP, expiry, and tray resources."""
        self._stop_event.set()
        self._discovery.remove_if_owned(self.instance_id)
        if self._server is not None:
            self._server.should_exit = True
        if self._tray is not None:
            self._tray.stop()
        if self._server_thread is not None and self._server_thread.is_alive():
            self._server_thread.join(timeout=5)
        if self._pruner_thread is not None and self._pruner_thread.is_alive():
            self._pruner_thread.join(timeout=2)
        if self._socket is not None:
            with suppress(OSError):
                self._socket.close()
            self._socket = None

    def _start_components(self) -> None:
        self._tray = create_tray(on_click=self.focus_dispatcher.focus_first, headless=self.config.headless)
        self._socket = self._bind_loopback_socket()
        port = int(self._socket.getsockname()[1])
        app = create_app(
            ApiContext(
                store=self.store,
                token=self.token,
                instance_id=self.instance_id,
                lease_ttl_seconds=self.config.lease_ttl_seconds,
                heartbeat_interval_seconds=self.config.heartbeat_interval_seconds,
            )
        )
        uvicorn_config = uvicorn.Config(
            app,
            host="127.0.0.1",
            port=port,
            log_level="info",
            access_log=False,
            log_config=None,
        )
        self._server = uvicorn.Server(uvicorn_config)
        self._server_thread = Thread(
            target=self._run_http_server,
            args=(self._socket,),
            name="neko-notifier-http",
            daemon=True,
        )
        self._server_thread.start()
        if not self._server_started(timeout_seconds=5):
            raise RuntimeError("HTTP server failed to start")

        self._pruner_thread = Thread(target=self._run_pruner, name="neko-notifier-pruner", daemon=True)
        self._pruner_thread.start()
        self._discovery.write(DiscoveryInfo.create(port=port, instance_id=self.instance_id, token=self.token))
        logger.info("neko-notifier ready host=127.0.0.1 port=%d instance_id=%s", port, self.instance_id)

    def _run_http_server(self, bound_socket: socket.socket) -> None:
        assert self._server is not None
        try:
            self._server.run(sockets=[bound_socket])
        except Exception:
            logger.exception("HTTP server terminated unexpectedly")
            self._stop_event.set()
            if self._tray is not None:
                self._tray.stop()

    def _run_pruner(self) -> None:
        interval = min(max(self.config.heartbeat_interval_seconds / 2, 0.5), 5.0)
        while not self._stop_event.wait(interval):
            try:
                removed = self.store.prune_expired()
                if removed:
                    logger.info("expired approval leases removed count=%d", removed)
            except Exception:
                logger.exception("approval lease pruning failed")

    def _server_started(self, *, timeout_seconds: float) -> bool:
        assert self._server is not None
        deadline_steps = max(1, int(timeout_seconds / 0.01))
        for _ in range(deadline_steps):
            if self._server.started:
                return True
            if self._server_thread is None or not self._server_thread.is_alive():
                return False
            self._stop_event.wait(0.01)
        return self._server.started

    def _on_count_changed(self, count: int) -> None:
        tray = self._tray
        if tray is not None:
            try:
                tray.update_count(count)
            except Exception:
                logger.exception("tray count update failed count=%d", count)

    @staticmethod
    def _bind_loopback_socket() -> socket.socket:
        bound_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            bound_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
            bound_socket.bind(("127.0.0.1", 0))
            bound_socket.listen(128)
            return bound_socket
        except Exception:
            bound_socket.close()
            raise
