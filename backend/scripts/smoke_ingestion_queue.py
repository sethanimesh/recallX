"""Opt-in real Redis/Celery smoke, with an isolated DB and deterministic draft provider.

Owns only the two processes it creates. No user database, broker, or model is used.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def wait_for(predicate, seconds=30):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        value = predicate()
        if value:
            return value
        time.sleep(0.1)
    raise TimeoutError("Local queue smoke condition did not complete")


def stop_owned(process):
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def run(report_path):
    import fitz
    import redis
    redis_binary = shutil.which("redis-server") or "/opt/homebrew/bin/redis-server"
    if not Path(redis_binary).is_file():
        raise RuntimeError("A local Redis executable is required")
    report = {"status": "running", "transport": "real localhost Redis + Celery solo worker", "parser": "real PyMuPDF native PDF", "draft_provider": "deterministic test fixture; no model inference", "lease_seconds_for_test": 3}
    started = time.monotonic()
    broker_process = worker_process = None
    with tempfile.TemporaryDirectory(prefix="recallx-ingestion-smoke-") as temporary:
        directory = Path(temporary)
        with socket.socket() as available:
            available.bind(("127.0.0.1", 0))
            port = available.getsockname()[1]
        os.environ.update(RECALLX_DB_PATH=str(directory / "test.sqlite"), RECALLX_DATA_DIR=str(directory / "assets"), RECALLX_REDIS_URL=f"redis://127.0.0.1:{port}/0")
        # Configure before importing settings or Celery: this script must be a fresh process.
        import database
        from ingestion import service
        from ingestion.dispatch import dispatch_pending, recover_jobs
        from ingestion.tasks import run_job
        database.init_db()
        document = fitz.open()
        page = document.new_page(width=400, height=400)
        page.insert_textbox(fitz.Rect(30, 30, 370, 180), "Ephemeral means lasting for a short time. The ephemeral rainbow disappeared after the rain.")
        payload = document.tobytes()
        document.close()
        job = service.submit(payload, "queue-fixture.pdf", "application/pdf", "real-queue-smoke", "", None)
        (directory / "smoke_worker.py").write_text('''
import functools
from pathlib import Path
import time
from ingestion import settings, worker
from ingestion.tasks import celery_app
settings.LEASE_SECONDS = 3
root = Path(__file__).parent
def fixture(text, instructions):
    assert "Ephemeral means" in text
    (root / "draft-started").write_text("native page checkpoint committed")
    while not (root / "release-draft").exists():
        time.sleep(0.1)
    return [{"word":"ephemeral","definition":"Lasting for a short time.","example_sentence":"The rainbow was ephemeral."}]
worker.process_job = functools.partial(worker.process_job, extractor=fixture)
''')
        environment = {**os.environ, "PYTHONPATH": os.pathsep.join([str(directory), str(ROOT)])}
        with (directory / "worker.log").open("w+") as worker_log, (directory / "redis.log").open("w+") as redis_log:
            try:
                dispatch_pending()  # Real connection refusal must leave the durable event pending.
                with database.connect() as conn:
                    event = dict(conn.execute("SELECT * FROM ingestion_outbox WHERE job_id=?", (job["id"],)).fetchone())
                    assert event["dispatched_at"] is None and event["attempts"] == 1
                report["broker_outage_preserved_outbox"] = True
                broker_process = subprocess.Popen([redis_binary, "--bind", "127.0.0.1", "--port", str(port), "--save", "", "--appendonly", "no", "--dir", str(directory)], stdout=redis_log, stderr=subprocess.STDOUT)
                broker = redis.Redis(host="127.0.0.1", port=port, socket_connect_timeout=0.2)
                def ping():
                    try:
                        return broker.ping()
                    except redis.ConnectionError:
                        return False
                wait_for(ping)
                command = [sys.executable, "-m", "celery", "-A", "smoke_worker:celery_app", "worker", "--pool=solo", "--concurrency=1", "--queues=celery", "--without-gossip", "--without-mingle", "--without-heartbeat", "--loglevel=INFO"]
                worker_process = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=worker_log, stderr=subprocess.STDOUT)
                dispatch_pending()
                wait_for(lambda: (directory / "draft-started").exists())
                checkpoint = service.get_job(job["id"])
                assert checkpoint["status"] == "extracting" and checkpoint["pages_done"] == 1
                with database.connect() as conn:
                    before = conn.execute("SELECT result_json FROM ingestion_stages WHERE job_id=? AND stage_key='page:1'", (job["id"],)).fetchone()[0]
                    lease_until = conn.execute("SELECT lease_until FROM ingestion_jobs WHERE id=?", (job["id"],)).fetchone()[0]
                # Abruptly stop this owned worker after its durable parse checkpoint.
                worker_process.kill()
                worker_process.wait(timeout=5)
                report["worker_killed_after_native_page_checkpoint"] = True
                wait_for(lambda: time.time() > lease_until + 1, seconds=8)
                recover_jobs()
                assert service.get_job(job["id"])["status"] == "queued"
                (directory / "release-draft").write_text("recover")
                worker_process = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=worker_log, stderr=subprocess.STDOUT)
                dispatch_pending()
                completed = wait_for(lambda: (j if (j := service.get_job(job["id"]))["status"] in {"ready", "failed"} else None))
                assert completed["status"] == "ready", completed.get("error_message")
                assert len(completed["candidates"]) == 1
                report["replacement_worker_recovered_job"] = True
                run_job.apply_async(args=[job["id"]], retry=False)
                wait_for(lambda: (directory / "worker.log").read_text().count(" succeeded in ") >= 2)
                with database.connect() as conn:
                    assert conn.execute("SELECT COUNT(*) FROM ingestion_pages WHERE job_id=?", (job["id"],)).fetchone()[0] == 1
                    assert conn.execute("SELECT COUNT(*) FROM ingestion_candidates WHERE job_id=?", (job["id"],)).fetchone()[0] == 1
                    assert conn.execute("SELECT result_json FROM ingestion_stages WHERE job_id=? AND stage_key='page:1'", (job["id"],)).fetchone()[0] == before
                report.update(status="passed", checkpoint_preserved=True, duplicate_delivery_idempotent=True, pages=1, candidates=1)
            except Exception as exc:
                report.update(status="failed", error=str(exc))
                raise
            finally:
                stop_owned(worker_process)
                stop_owned(broker_process)
                report["elapsed_seconds"] = round(time.monotonic() - started, 3)
                report_path.parent.mkdir(parents=True, exist_ok=True)
                report_path.write_text(json.dumps(report, indent=2) + "\n")
                worker_log.flush()
                shutil.copyfile(directory / "worker.log", report_path.with_suffix(".worker.log"))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, default=ROOT.parent / "evaluation" / "local" / "ingestion" / "redis-smoke.json")
    run(parser.parse_args().report)
