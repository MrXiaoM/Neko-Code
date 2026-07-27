from __future__ import annotations

import ctypes
import json
from pathlib import Path
from types import SimpleNamespace

from pytest import MonkeyPatch

from neko_notifier import PROTOCOL_VERSION, focus, tray
from neko_notifier.discovery import DiscoveryFile, DiscoveryInfo
from neko_notifier.focus import FocusDispatcher, invoke_focus_callback
from neko_notifier.icons import badge_number, render_tray_icon
from neko_notifier.store import ApprovalStore, LeaseInput


def test_discovery_file_is_valid_and_only_owner_can_remove(tmp_path: Path) -> None:
    discovery = DiscoveryFile(tmp_path)
    info = DiscoveryInfo.create(port=43123, instance_id="instance-a", token="token-a")

    discovery.write(info)

    parsed = json.loads((tmp_path / "neko-notifier.json").read_text(encoding="utf-8"))
    assert parsed["protocolVersion"] == PROTOCOL_VERSION
    assert parsed["host"] == "127.0.0.1"
    assert parsed["port"] == 43123
    assert parsed["instanceId"] == "instance-a"
    assert not list(tmp_path.glob("*.tmp"))
    assert discovery.remove_if_owned("instance-b") is False
    assert discovery.path.exists()
    assert discovery.remove_if_owned("instance-a") is True
    assert not discovery.path.exists()


def test_new_discovery_owner_is_not_deleted_by_old_instance(tmp_path: Path) -> None:
    discovery = DiscoveryFile(tmp_path)
    discovery.write(DiscoveryInfo.create(port=41001, instance_id="old", token="old-token"))
    discovery.write(DiscoveryInfo.create(port=41002, instance_id="new", token="new-token"))

    assert discovery.remove_if_owned("old") is False
    assert json.loads(discovery.path.read_text(encoding="utf-8"))["instanceId"] == "new"


def test_repeated_focus_clicks_keep_invoking_fifo_head_without_dismissal() -> None:
    store = ApprovalStore()
    store.upsert(
        LeaseInput(
            notification_id="first",
            title="First",
            body="Body",
            callback_url="http://127.0.0.1:41000/focus",
            callback_token="x" * 48,
            client_id="window-1",
        )
    )
    store.upsert(
        LeaseInput(
            notification_id="second",
            title="Second",
            body="Body",
            callback_url="http://127.0.0.1:41001/focus",
            callback_token="y" * 48,
            client_id="window-2",
        )
    )
    invoked: list[str] = []
    dispatcher = FocusDispatcher(store, invoke=lambda lease: not invoked.append(lease.notification_id))

    first_result = dispatcher.focus_first()
    second_result = dispatcher.focus_first()

    assert first_result.succeeded is True
    assert second_result.succeeded is True
    assert invoked == ["first", "first"]
    assert [item.notification_id for item in store.snapshot()] == ["first", "second"]


def test_failed_focus_does_not_remove_fifo_head() -> None:
    store = ApprovalStore()
    store.upsert(
        LeaseInput(
            notification_id="first",
            title="First",
            body="Body",
            callback_url="http://127.0.0.1:41000/focus",
            callback_token="x" * 48,
            client_id="window-1",
        )
    )
    dispatcher = FocusDispatcher(store, invoke=lambda _lease: False)

    assert dispatcher.focus_first().succeeded is False
    assert store.first() is not None
    assert store.first().notification_id == "first"


def test_focus_callback_uses_authenticated_post_and_launches_returned_target(monkeypatch) -> None:
    store = ApprovalStore()
    lease = store.upsert(
        LeaseInput(
            notification_id="approval-1",
            title="Approval",
            body="Body",
            callback_url="http://127.0.0.1:41000/neko-notifier-focus/token",
            callback_token="x" * 48,
            client_id="window-1",
        )
    )
    captured: dict[str, object] = {}

    class Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def read(self, _size: int) -> bytes:
            return b"ok\nC:/Code/bin/code.cmd\nE:/Zoo-Code"

    class Opener:
        def open(self, request, timeout: float):
            captured["method"] = request.method
            captured["authorization"] = request.headers["Authorization"]
            captured["timeout"] = timeout
            return Response()

    monkeypatch.setattr(focus, "build_opener", lambda *_handlers: Opener())
    monkeypatch.setattr(
        focus,
        "_launch_editor",
        lambda editor, workspace: captured.update(editor=editor, workspace=workspace) is None,
    )

    assert invoke_focus_callback(lease) is True
    assert captured == {
        "method": "POST",
        "authorization": f"Bearer {lease.callback_token}",
        "timeout": 1.5,
        "editor": "C:/Code/bin/code.cmd",
        "workspace": "E:/Zoo-Code",
    }


def test_focus_callback_rejects_invalid_instruction_body(monkeypatch) -> None:
    store = ApprovalStore()
    lease = store.upsert(
        LeaseInput(
            notification_id="approval-1",
            title="Approval",
            body="Body",
            callback_url="http://127.0.0.1:41000/focus",
            callback_token="x" * 48,
            client_id="window-1",
        )
    )

    class Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def read(self, _size: int) -> bytes:
            return b"ok\nmissing-workspace"

    class Opener:
        def open(self, _request, timeout: float):
            del timeout
            return Response()

    monkeypatch.setattr(focus, "build_opener", lambda *_handlers: Opener())
    monkeypatch.setattr(focus, "_launch_editor", lambda *_args: (_ for _ in ()).throw(AssertionError()))

    assert invoke_focus_callback(lease) is False


def test_windows_timer_helpers_use_user32(monkeypatch: MonkeyPatch) -> None:
    calls: list[tuple[str, tuple[object, ...]]] = []

    class User32:
        def SetTimer(self, *args: object) -> int:
            calls.append(("set", args))
            return 1

        def KillTimer(self, *args: object) -> int:
            calls.append(("kill", args))
            return 1

    monkeypatch.setattr(ctypes, "windll", SimpleNamespace(user32=User32()), raising=False)

    tray._set_timer(123, 1, 650)
    tray._kill_timer(123, 1)

    assert calls == [("set", (123, 1, 650, None)), ("kill", (123, 1))]


def test_windows_tray_uses_faster_default_flash_interval() -> None:
    windows_tray = tray.WindowsTray(on_click=lambda: None)

    assert windows_tray._flash_interval_ms == 325


def test_badge_is_single_digit_and_icon_renders_with_high_contrast_flash() -> None:
    assert badge_number(0) is None
    assert badge_number(1) == 1
    assert badge_number(8) == 8
    assert badge_number(9) == 9
    assert badge_number(52) == 9

    normal = render_tray_icon(0)
    highlighted = render_tray_icon(0, highlighted=True)
    busy = render_tray_icon(17, highlighted=True)

    assert normal.size == (32, 32)
    assert highlighted.size == (32, 32)
    assert busy.size == (32, 32)
    assert normal.getpixel((16, 10)) == (128, 92, 220, 255)
    assert highlighted.getpixel((16, 10)) == (255, 190, 0, 255)
    assert normal.tobytes() != highlighted.tobytes()
    assert highlighted.tobytes() != busy.tobytes()
