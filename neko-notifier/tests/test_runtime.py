from __future__ import annotations

import sys

import uvicorn
from fastapi import FastAPI


def test_uvicorn_configuration_does_not_require_stdout_when_log_config_is_disabled(monkeypatch) -> None:
    monkeypatch.setattr(sys, "stdout", None)

    config = uvicorn.Config(FastAPI(), log_config=None)

    assert config.log_config is None
