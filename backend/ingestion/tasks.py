import os
from celery import Celery

celery_app = Celery("recallx", broker=os.getenv("RECALLX_REDIS_URL", "redis://127.0.0.1:6379/0"), include=["services.optimization_tasks"])
celery_app.conf.update(
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_ignore_result=True,
    broker_connection_timeout=2,
    broker_transport_options={"visibility_timeout": 900, "socket_connect_timeout": 2, "socket_timeout": 2},
    task_serializer="json", accept_content=["json"],
    beat_schedule={"recover-ingestion": {"task": "recallx.ingestion.recover", "schedule": 30.0}, "recover-optimization": {"task": "services.optimization.dispatch", "schedule": 30.0}},
)


@celery_app.task(name="recallx.ingestion.run")
def run_job(job_id):
    from ingestion.worker import process_job
    process_job(job_id)


@celery_app.task(name="recallx.ingestion.recover")
def recover():
    from ingestion.dispatch import tick
    tick()
