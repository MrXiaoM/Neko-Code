"""Discovery-file persistence and data-directory single-instance locking."""

from __future__ import annotations

import importlib
import json
import os
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import IO, Any

from . import DISCOVERY_FILE_NAME, PROTOCOL_VERSION


@dataclass(frozen=True, slots=True)
class DiscoveryInfo:
    """Connection metadata consumed by Zoo Code extension windows."""

    protocol_version: int
    host: str
    port: int
    pid: int
    instance_id: str
    token: str
    started_at: str

    @classmethod
    def create(cls, *, port: int, instance_id: str, token: str) -> DiscoveryInfo:
        return cls(
            protocol_version=PROTOCOL_VERSION,
            host="127.0.0.1",
            port=port,
            pid=os.getpid(),
            instance_id=instance_id,
            token=token,
            started_at=datetime.now(UTC).isoformat(),
        )

    def to_wire(self) -> dict[str, int | str]:
        raw = asdict(self)
        return {
            "protocolVersion": raw["protocol_version"],
            "host": raw["host"],
            "port": raw["port"],
            "pid": raw["pid"],
            "instanceId": raw["instance_id"],
            "token": raw["token"],
            "startedAt": raw["started_at"],
        }


class AlreadyRunningError(RuntimeError):
    """Raised when another service process owns the selected data directory."""


class DataDirectoryLock:
    """Hold an exclusive OS lock for one service data directory."""

    def __init__(self, data_dir: Path) -> None:
        self._data_dir = data_dir
        self._path = data_dir / ".neko-notifier.lock"
        self._file: IO[bytes] | None = None

    def acquire(self) -> None:
        self._data_dir.mkdir(parents=True, exist_ok=True)
        lock_file = self._path.open("a+b")
        try:
            lock_file.seek(0)
            if lock_file.read(1) == b"":
                lock_file.seek(0)
                lock_file.write(b"0")
                lock_file.flush()
            lock_file.seek(0)
            self._lock_file(lock_file)
        except OSError as error:
            lock_file.close()
            raise AlreadyRunningError(f"another neko-notifier instance owns {self._data_dir}") from error
        self._file = lock_file

    def release(self) -> None:
        lock_file, self._file = self._file, None
        if lock_file is None:
            return
        try:
            lock_file.seek(0)
            self._unlock_file(lock_file)
        finally:
            lock_file.close()

    def __enter__(self) -> DataDirectoryLock:
        self.acquire()
        return self

    def __exit__(self, _exc_type: object, _exc: object, _traceback: object) -> None:
        self.release()

    @staticmethod
    def _lock_file(lock_file: IO[bytes]) -> None:
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
            return

        fcntl = importlib.import_module("fcntl")
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)

    @staticmethod
    def _unlock_file(lock_file: IO[bytes]) -> None:
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
            return

        fcntl = importlib.import_module("fcntl")
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


class DiscoveryFile:
    """Atomically publish and safely remove service discovery metadata."""

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.path = data_dir / DISCOVERY_FILE_NAME

    def write(self, info: DiscoveryInfo) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        temporary = self.data_dir / f".{DISCOVERY_FILE_NAME}.{info.instance_id}.tmp"
        payload = json.dumps(info.to_wire(), ensure_ascii=False, separators=(",", ":")) + "\n"
        try:
            with temporary.open("w", encoding="utf-8", newline="\n") as file:
                file.write(payload)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, self.path)
        finally:
            temporary.unlink(missing_ok=True)

    def remove_if_owned(self, instance_id: str) -> bool:
        current = self._read_object()
        if current is None or current.get("instanceId") != instance_id:
            return False
        try:
            self.path.unlink()
        except FileNotFoundError:
            return False
        return True

    def _read_object(self) -> dict[str, Any] | None:
        try:
            if self.path.stat().st_size > 64 * 1024:
                return None
            value = json.loads(self.path.read_text(encoding="utf-8"))
        except (FileNotFoundError, OSError, UnicodeError, json.JSONDecodeError):
            return None
        return value if isinstance(value, dict) else None
