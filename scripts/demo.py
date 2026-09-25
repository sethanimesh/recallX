"""Run an isolated, provider-free browser demo with constructed vocabulary."""
import argparse
import errno
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.request import Request, urlopen
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[1]


def request(base, path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = json.dumps(body).encode() if body is not None else None
    with urlopen(Request(base + path, data=data, headers=headers), timeout=5) as response:
        return json.load(response)


def available(port):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", port))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-port", type=int, default=8876)
    parser.add_argument("--web-port", type=int, default=8877)
    args = parser.parse_args()
    if args.api_port == args.web_port:
        parser.error("API and web ports must differ.")
    if not (ROOT / "dist/index.html").exists():
        parser.error("Build the browser app first: npm run export:web")
    for port in (args.api_port, args.web_port):
        try:
            available(port)
        except OSError as error:
            if error.errno == errno.EADDRINUSE:
                parser.error(f"Port {port} is already in use; choose another port.")
            parser.error(f"Cannot bind local port {port}: {error}")
    workspace = Path(tempfile.mkdtemp(prefix="recallx-demo-"))
    env = os.environ.copy()
    env.update({
        "RECALLX_DB_PATH": str(workspace / "demo.sqlite"),
        "RECALLX_DATA_DIR": str(workspace / "data"),
        "RECALLX_DISABLE_DISPATCH": "1",
        "RECALLX_WEB_ORIGINS": f"http://localhost:{args.web_port},http://127.0.0.1:{args.web_port}",
        "RECALLX_BOOTSTRAP_SECRET": str(uuid4()),
        "RECALLX_CALIBRATION_PATH": str(workspace / "unconfigured-calibration.json"),
        "PROVIDER_PRIORITY": "",
    })
    for key in ("OPENAI_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY",
                "MISTRAL_API_KEY", "HF_API_KEY", "HF_TOKEN", "OLLAMA_API_KEY"):
        env[key] = ""
    children = []
    api = f"http://127.0.0.1:{args.api_port}"
    try:
        with (workspace / "api.log").open("w") as api_log, (workspace / "web.log").open("w") as web_log:
            children.append(subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(args.api_port)],
                cwd=ROOT / "backend", env=env, stdout=api_log, stderr=subprocess.STDOUT, start_new_session=True))
            for _ in range(100):
                if children[0].poll() is not None:
                    raise RuntimeError(f"API startup failed. See {workspace / 'api.log'}")
                try:
                    request(api, "/health")
                    break
                except (URLError, TimeoutError):
                    time.sleep(0.1)
            else:
                raise RuntimeError(f"API startup timed out. See {workspace / 'api.log'}")
            identity = request(api, "/pairing/bootstrap", {
                "bootstrap_secret": env["RECALLX_BOOTSTRAP_SECRET"], "device_name": "Demo fixture seeder"})
            fixture = json.loads((ROOT / "examples/demo-library.json").read_text())
            for word in fixture["words"]:
                now = int(time.time() * 1000)
                request(api, "/words", {**word, "id": str(uuid4()), "source_type": "manual", "created_at": now, "updated_at": now}, identity["token"])
            children.append(subprocess.Popen(
                [sys.executable, str(ROOT / "backend/scripts/serve_web.py"), "--host", "127.0.0.1", "--port", str(args.web_port), "--directory", str(ROOT / "dist")],
                cwd=ROOT, env=env, stdout=web_log, stderr=subprocess.STDOUT, start_new_session=True))
            print(f"Browser: http://localhost:{args.web_port}", flush=True)
            print(f"In Connection and sync, set Server URL to {api}", flush=True)
            print(f"First-device bootstrap secret: {env['RECALLX_BOOTSTRAP_SECRET']}", flush=True)
            print(f"Sample library: {len(fixture['words'])} words; temporary data: {workspace}", flush=True)
            print("No real learner data, generative providers, model downloads or ingestion workers. Ctrl-C stops this demo.", flush=True)
            while True:
                for child in children:
                    if child.poll() is not None:
                        raise RuntimeError(f"A demo process stopped. See logs in {workspace}")
                time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        for child in reversed(children):
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
        print(f"Demo stopped. Its isolated sample data and logs remain in {workspace}", flush=True)


if __name__ == "__main__":
    main()
