"""Owned inference children must stop before the outer memory lease is released."""
from contextlib import nullcontext
from types import SimpleNamespace
import subprocess

import pytest

from ingestion import mlx_service


class Child:
    def __init__(self, events, hang=False):
        self.events = events
        self.hang = hang
        self.returncode = None

    def poll(self):
        return self.returncode

    def terminate(self):
        self.events.append("terminate")

    def kill(self):
        self.events.append("kill")
        self.returncode = -9

    def wait(self, timeout):
        self.events.append("wait")
        if self.hang and self.returncode is None:
            raise subprocess.TimeoutExpired("owned-mlx", timeout)
        self.returncode = self.returncode or -15
        return self.returncode


@pytest.mark.parametrize("hang", [False, True])
def test_owned_service_is_stopped_after_page_failure(tmp_path, monkeypatch, hang):
    events = []
    child = Child(events, hang)
    interpreter = tmp_path / "python"
    interpreter.touch()
    monkeypatch.setenv("RECALLX_MLX_PYTHON", str(interpreter))

    class Port:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def bind(self, address):
            assert address == ("127.0.0.1", 0)

        def getsockname(self):
            return ("127.0.0.1", 43210)

    def launch(command, **kwargs):
        assert command[0] == str(interpreter)
        assert command[-1] == "43210"
        assert kwargs["pass_fds"] == (37,)
        events.append("launch")
        return child

    def health(url, **kwargs):
        assert url == "http://127.0.0.1:43210/health"
        return nullcontext(SimpleNamespace(status=200))

    monkeypatch.setattr(mlx_service.socket, "socket", Port)
    monkeypatch.setattr(mlx_service.subprocess, "Popen", launch)
    monkeypatch.setattr(mlx_service, "urlopen", health)
    with pytest.raises(RuntimeError, match="page failed"):
        with mlx_service.managed_mlx_service(tmp_path, 37) as url:
            assert url == "http://127.0.0.1:43210"
            events.append("page")
            raise RuntimeError("page failed")
    events.append("lease may now release")
    assert events == ["launch", "page", "terminate", "wait"] + (["kill", "wait"] if hang else []) + ["lease may now release"]
    assert child.returncode is not None


def test_missing_service_environment_does_not_silently_fall_back(tmp_path, monkeypatch):
    monkeypatch.setenv("RECALLX_MLX_PYTHON", str(tmp_path / "missing"))
    with pytest.raises(RuntimeError, match="MLX environment is unavailable"):
        with mlx_service.managed_mlx_service(tmp_path, 1):
            raise AssertionError("A missing MLX runtime must fail explicitly")
