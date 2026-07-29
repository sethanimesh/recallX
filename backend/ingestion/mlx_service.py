"""Start and stop the MLX recognition service inside an already-held Mac lease."""
from contextlib import contextmanager
import logging
import os
from pathlib import Path
import socket
import subprocess
import time
from urllib.request import urlopen

logger = logging.getLogger(__name__)


@contextmanager
def managed_mlx_service(directory: Path, lease_fd: int):
    python = Path(os.getenv("RECALLX_MLX_PYTHON", str(Path(__file__).resolve().parents[1] / ".venv-mlx/bin/python")))
    if not python.is_file():
        raise RuntimeError("Local MLX environment is unavailable; configure RECALLX_MLX_PYTHON")
    with socket.socket() as available:
        available.bind(("127.0.0.1", 0))
        port = available.getsockname()[1]
    url = f"http://127.0.0.1:{port}"
    log_path = directory / "mlx-service.log"
    with log_path.open("w+") as log:
        process = subprocess.Popen([str(python), str(Path(__file__).with_name("mlx_runner.py")), str(port)], stdout=log, stderr=subprocess.STDOUT, pass_fds=(lease_fd,))
        try:
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError("Local MLX service failed to start")
                try:
                    with urlopen(f"{url}/health", timeout=0.5) as response:
                        if response.status == 200:
                            break
                except OSError:
                    time.sleep(0.1)
            else:
                raise RuntimeError("Local MLX service startup exceeded 45 seconds")
            yield url
        finally:
            # Stop only our child. Process teardown frees Metal allocations before
            # another inference framework receives the shared lease.
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            log.flush()
            tail = log_path.read_text()[-6000:]
            if process.returncode not in {0, -15}:
                logger.error("MLX service failed: %s", tail)
            evidence = os.getenv("RECALLX_MLX_LOG_PATH")
            if evidence:
                Path(evidence).write_text(log_path.read_text())
