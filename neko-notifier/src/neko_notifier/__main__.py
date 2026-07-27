"""Command-line entry point for the standalone notifier service."""

from __future__ import annotations

import argparse
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

from .discovery import AlreadyRunningError
from .runtime import RuntimeConfig, ServiceRuntime


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the standalone Neko Notifier approval tray service.")
    parser.add_argument(
        "--data-dir",
        type=Path,
        required=True,
        help="Directory in which neko-notifier.json and service logs are stored.",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Disable the Windows tray icon. Intended only for automated tests and diagnostics.",
    )
    return parser


def configure_logging(data_dir: Path) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    formatter = logging.Formatter(
        fmt="%(asctime)s.%(msecs)03d %(levelname)s %(threadName)s %(name)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    file_handler = RotatingFileHandler(
        data_dir / "neko-notifier.log",
        maxBytes=2 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logging.basicConfig(level=logging.INFO, handlers=[file_handler, console_handler], force=True)


def main() -> None:
    args = build_parser().parse_args()
    data_dir = args.data_dir.expanduser().resolve()
    configure_logging(data_dir)
    runtime = ServiceRuntime(RuntimeConfig(data_dir=data_dir, headless=args.headless))
    try:
        runtime.run()
    except AlreadyRunningError as error:
        logging.getLogger(__name__).error("%s", error)
        raise SystemExit(2) from error
    except Exception:
        logging.getLogger(__name__).exception("neko-notifier terminated unexpectedly")
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
