import logging
import time
import uuid
import database

logger = logging.getLogger(__name__)


def recover_jobs():
    """Leases and broker-stalled queued jobs are recoverable from SQLite alone."""
    now = int(time.time())
    with database.connect(immediate=True) as conn:
        expired = conn.execute("UPDATE ingestion_jobs SET status='queued',stage='recovering',lease_token=NULL,lease_until=NULL,updated_at=? WHERE status IN ('parsing','extracting') AND lease_until<? RETURNING id", (now, now)).fetchall()
        # A dead worker may still have an unacknowledged broker delivery. The DB
        # lease fences duplicates, so recovery need not wait for broker visibility.
        for job in expired:
            conn.execute("INSERT INTO ingestion_outbox(id,job_id,created_at) VALUES(?,?,?)", (str(uuid.uuid4()), job["id"], now))
        queued = conn.execute("SELECT id FROM ingestion_jobs j WHERE status='queued' AND NOT EXISTS (SELECT 1 FROM ingestion_outbox o WHERE o.job_id=j.id AND (o.dispatched_at IS NULL OR o.dispatched_at>?))", (now - 60,)).fetchall()
        for job in queued:
            conn.execute("INSERT INTO ingestion_outbox(id,job_id,created_at) VALUES(?,?,?)", (str(uuid.uuid4()), job["id"], now))


def dispatch_pending():
    from ingestion.tasks import run_job
    with database.connect() as conn:
        events = [dict(r) for r in conn.execute("SELECT o.id,o.job_id FROM ingestion_outbox o JOIN ingestion_jobs j ON j.id=o.job_id WHERE o.dispatched_at IS NULL AND j.status='queued' ORDER BY o.created_at LIMIT 20")]
    for event in events:
        try:
            run_job.apply_async(args=[event["job_id"]], task_id=event["id"], retry=False)
        except Exception:
            logger.warning("Broker unavailable; persisted ingestion dispatch will retry", exc_info=True)
            with database.connect() as conn:
                conn.execute("UPDATE ingestion_outbox SET attempts=attempts+1 WHERE id=?", (event["id"],))
            break
        with database.connect() as conn:
            conn.execute("UPDATE ingestion_outbox SET dispatched_at=?,attempts=attempts+1 WHERE id=?", (int(time.time()), event["id"]))


def tick():
    recover_jobs()
    dispatch_pending()
