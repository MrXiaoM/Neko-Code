"""Focus callback dispatch for the first pending approval."""

from __future__ import annotations

import logging
import os
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from . import PROTOCOL_VERSION
from .store import ApprovalLease, ApprovalStore

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class FocusResult:
    attempted: bool
    succeeded: bool
    notification_id: str | None = None


class _RejectRedirects(HTTPRedirectHandler):
    def redirect_request(
        self,
        req: Request,
        fp: object,
        code: int,
        msg: str,
        headers: object,
        newurl: str,
    ) -> None:
        del req, fp, code, msg, headers, newurl
        return None


def _launch_editor(editor_path: str, workspace_path: str) -> bool:
    editor = Path(editor_path)
    workspace = Path(workspace_path)
    if not editor.is_file() or not workspace.is_dir():
        return False
    creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        subprocess.Popen(
            [str(editor), "--reuse-window", str(workspace)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creation_flags,
            close_fds=True,
        )
    except OSError as error:
        logger.warning("host editor launch failed editor=%s workspace=%s error=%s", editor, workspace, error)
        return False
    return True


def invoke_focus_callback(lease: ApprovalLease, *, timeout_seconds: float = 1.5) -> bool:
    """Request focus instructions and launch the owning editor window without a console."""
    request = Request(
        lease.callback_url,
        method="POST",
        headers={
            "Authorization": f"Bearer {lease.callback_token}",
            "Content-Type": "application/json",
            "X-Neko-Protocol-Version": str(PROTOCOL_VERSION),
            "X-Neko-Notification-Id": lease.notification_id,
        },
        data=b"{}",
    )
    try:
        with build_opener(_RejectRedirects).open(request, timeout=timeout_seconds) as response:
            status_code = int(response.status)
            if not 200 <= status_code < 300:
                return False
            body = response.read(16 * 1024 + 1)
            if len(body) > 16 * 1024:
                return False
            lines = body.decode("utf-8").splitlines()
            if len(lines) != 3 or lines[0] != "ok":
                return False
            return _launch_editor(lines[1], lines[2])
    except (HTTPError, URLError, OSError, TimeoutError) as error:
        logger.warning("approval focus callback failed notification_id=%s error=%s", lease.notification_id, error)
        return False


class FocusDispatcher:
    """Repeatedly focus the current FIFO head without mutating the queue."""

    def __init__(
        self,
        store: ApprovalStore,
        *,
        invoke: Callable[[ApprovalLease], bool] = invoke_focus_callback,
    ) -> None:
        self._store = store
        self._invoke = invoke

    def focus_first(self) -> FocusResult:
        lease = self._store.first()
        if lease is None:
            return FocusResult(attempted=False, succeeded=False)
        succeeded = self._invoke(lease)
        return FocusResult(attempted=True, succeeded=succeeded, notification_id=lease.notification_id)
