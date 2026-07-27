"""Windows notification-area icon with flashing state and approval badge."""

from __future__ import annotations

import ctypes
import logging
import os
import tempfile
from collections.abc import Callable
from pathlib import Path
from threading import Lock, Thread

from .icons import render_tray_icon

logger = logging.getLogger(__name__)


def _set_timer(hwnd: int, timer_id: int, interval_ms: int) -> None:
    if not ctypes.windll.user32.SetTimer(hwnd, timer_id, interval_ms, None):
        raise ctypes.WinError()


def _kill_timer(hwnd: int, timer_id: int) -> None:
    if not ctypes.windll.user32.KillTimer(hwnd, timer_id):
        raise ctypes.WinError()


class WindowsTray:
    """Own a hidden Win32 window and its notification-area icon."""

    _WM_TRAY = 0x0400 + 20
    _WM_COUNT_CHANGED = 0x0400 + 21
    _TIMER_ID = 1

    def __init__(self, *, on_click: Callable[[], object], flash_interval_ms: int = 325) -> None:
        if os.name != "nt":
            raise RuntimeError("WindowsTray is only available on Windows")
        if flash_interval_ms < 100:
            raise ValueError("flash_interval_ms must be at least 100")
        self._on_click = on_click
        self._flash_interval_ms = flash_interval_ms
        self._pending_count = 0
        self._pending_lock = Lock()
        self._hwnd: int | None = None
        self._icon_handle: int | None = None
        self._highlighted = False
        self._temp_dir: tempfile.TemporaryDirectory[str] | None = None

    def update_count(self, count: int) -> None:
        """Thread-safely publish a new count to the tray message loop."""
        with self._pending_lock:
            self._pending_count = max(0, count)
        if self._hwnd is not None:
            import win32gui

            win32gui.PostMessage(self._hwnd, self._WM_COUNT_CHANGED, 0, 0)

    def run(self) -> None:
        """Run the tray message pump on the calling thread until stop is requested."""
        import win32api
        import win32con
        import win32gui

        class_name = f"NekoNotifierTray-{os.getpid()}"
        message_map = {
            self._WM_TRAY: self._handle_tray_event,
            self._WM_COUNT_CHANGED: self._handle_count_changed,
            win32con.WM_TIMER: self._handle_timer,
            win32con.WM_DESTROY: self._handle_destroy,
        }
        window_class = win32gui.WNDCLASS()
        window_class.hInstance = win32api.GetModuleHandle(None)
        window_class.lpszClassName = class_name
        window_class.lpfnWndProc = message_map
        atom = win32gui.RegisterClass(window_class)
        del atom

        self._temp_dir = tempfile.TemporaryDirectory(prefix="neko-notifier-icons-")
        try:
            self._hwnd = win32gui.CreateWindow(
                class_name,
                "Neko Notifier",
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                window_class.hInstance,
                None,
            )
            self._replace_icon()
            flags = win32gui.NIF_ICON | win32gui.NIF_MESSAGE | win32gui.NIF_TIP
            icon_data = (self._hwnd, 0, flags, self._WM_TRAY, self._icon_handle, "Neko Notifier")
            win32gui.Shell_NotifyIcon(win32gui.NIM_ADD, icon_data)
            _set_timer(self._hwnd, self._TIMER_ID, self._flash_interval_ms)
            win32gui.PumpMessages()
        finally:
            self._cleanup()

    def stop(self) -> None:
        """Ask the tray message loop to terminate."""
        if self._hwnd is not None:
            import win32con
            import win32gui

            win32gui.PostMessage(self._hwnd, win32con.WM_CLOSE, 0, 0)

    def _handle_tray_event(self, _hwnd: int, _message: int, _wparam: int, lparam: int) -> int:
        import win32con

        if lparam in {win32con.WM_LBUTTONUP, win32con.WM_LBUTTONDBLCLK}:
            Thread(target=self._invoke_click, name="neko-notifier-focus", daemon=True).start()
        return 0

    def _invoke_click(self) -> None:
        try:
            self._on_click()
        except Exception:
            logger.exception("tray click handler failed")

    def _handle_count_changed(self, _hwnd: int, _message: int, _wparam: int, _lparam: int) -> int:
        self._highlighted = False
        self._replace_icon_and_notify()
        return 0

    def _handle_timer(self, _hwnd: int, _message: int, timer_id: int, _time: int) -> int:
        if timer_id != self._TIMER_ID:
            return 0
        count = self._get_count()
        if count <= 0:
            if self._highlighted:
                self._highlighted = False
                self._replace_icon_and_notify()
            return 0
        self._highlighted = not self._highlighted
        self._replace_icon_and_notify()
        return 0

    def _handle_destroy(self, _hwnd: int, _message: int, _wparam: int, _lparam: int) -> int:
        import win32gui

        win32gui.PostQuitMessage(0)
        return 0

    def _replace_icon_and_notify(self) -> None:
        import win32gui

        if self._hwnd is None:
            return
        self._replace_icon()
        count = self._get_count()
        tooltip = "Neko Notifier" if count == 0 else f"Neko Notifier — {count} pending approval(s)"
        win32gui.Shell_NotifyIcon(
            win32gui.NIM_MODIFY,
            (self._hwnd, 0, win32gui.NIF_ICON | win32gui.NIF_TIP, self._WM_TRAY, self._icon_handle, tooltip[:127]),
        )

    def _replace_icon(self) -> None:
        import win32con
        import win32gui

        if self._temp_dir is None:
            raise RuntimeError("tray temporary directory is unavailable")
        count = self._get_count()
        image = render_tray_icon(count, highlighted=self._highlighted)
        icon_path = Path(self._temp_dir.name) / f"icon-{count}-{int(self._highlighted)}.ico"
        image.save(icon_path, format="ICO", sizes=[(32, 32)])
        new_handle = win32gui.LoadImage(
            0,
            str(icon_path),
            win32con.IMAGE_ICON,
            32,
            32,
            win32con.LR_LOADFROMFILE,
        )
        old_handle, self._icon_handle = self._icon_handle, new_handle
        if old_handle is not None:
            win32gui.DestroyIcon(old_handle)

    def _get_count(self) -> int:
        with self._pending_lock:
            return self._pending_count

    def _cleanup(self) -> None:
        try:
            import win32gui

            if self._hwnd is not None:
                try:
                    _kill_timer(self._hwnd, self._TIMER_ID)
                    win32gui.Shell_NotifyIcon(win32gui.NIM_DELETE, (self._hwnd, 0))
                except (OSError, win32gui.error):
                    pass
            if self._icon_handle is not None:
                win32gui.DestroyIcon(self._icon_handle)
        finally:
            self._icon_handle = None
            self._hwnd = None
            if self._temp_dir is not None:
                self._temp_dir.cleanup()
                self._temp_dir = None


class NullTray:
    """Headless tray adapter for tests and explicitly non-Windows environments."""

    def __init__(self, *, on_click: Callable[[], object]) -> None:
        self.on_click = on_click
        self.count = 0

    def update_count(self, count: int) -> None:
        self.count = max(0, count)

    def run(self) -> None:
        return

    def stop(self) -> None:
        return


def create_tray(*, on_click: Callable[[], object], headless: bool = False) -> WindowsTray | NullTray:
    if headless:
        return NullTray(on_click=on_click)
    return WindowsTray(on_click=on_click)
