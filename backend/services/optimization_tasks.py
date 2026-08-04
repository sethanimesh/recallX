"""Durable optimizer dispatch on the same local broker, separate bounded worker queue."""
from datetime import datetime,timedelta,timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4
import database
from ingestion.tasks import celery_app
from services import scheduling as s
from services.optimization import clean_history,eligibility,compare


def history_hash(events):
    return hashlib.sha256(json.dumps(events,sort_keys=True).encode()).hexdigest()


def run_fit_process(events):
    interpreter=os.environ.get('RECALLX_OPTIMIZER_PYTHON',str(Path(__file__).resolve().parents[1]/'.venv-grading/bin/python'))
    env=os.environ.copy();env['OMP_NUM_THREADS']='2';env['MKL_NUM_THREADS']='2'
    from local_runtime import inference_lease
    with inference_lease() as lease_fd:
        # The child retains the lease if the worker dies; its own alarm bounds
        # that ownership. Normal timeout teardown finishes before lock release.
        return subprocess.run([interpreter,'-m','services.optimization'],input=json.dumps({'events':events}),text=True,capture_output=True,cwd=Path(__file__).resolve().parents[1],timeout=910,env=env,pass_fds=(lease_fd,))


def assert_frozen_history(conn,job,events,baseline,attempt):
    """Do not publish evidence computed from a history changed during inference."""
    lease=conn.execute('SELECT status,attempts FROM optimization_jobs WHERE id=?',(job['id'],)).fetchone()
    if not lease or lease['status']!='running' or lease['attempts']!=attempt:
        raise ValueError('Optimizer worker lease was superseded')
    latest=clean_history(conn,job['learner_id'],job['mode'])
    cutoff=max((e['at'] for e in events),default='')
    frozen=[e for e in latest if e['at']<=cutoff]
    if history_hash(frozen)!=history_hash(events):
        raise ValueError('History changed during fitting or validation; retry with a fresh snapshot')
    if s.active_parameters(conn,job['learner_id'],job['mode'])['id']!=baseline['id']:
        raise ValueError('Active parameters changed during fitting or validation')


@celery_app.task(name='services.optimization.dispatch')
def dispatch():
    with database.connect(immediate=True) as conn:
        cutoff=(datetime.now(timezone.utc)-timedelta(minutes=20)).isoformat()
        conn.execute("UPDATE optimization_jobs SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,error='Worker lease expired' WHERE status IN ('running','queued') AND updated_at<?",(cutoff,))
        rows=conn.execute("SELECT id FROM optimization_jobs WHERE status='pending'").fetchall()
    for row in rows:
        try:
            run_job.apply_async(args=[row['id']],queue='optimization')
        except Exception:
            continue
        with database.connect() as conn: conn.execute("UPDATE optimization_jobs SET status='queued',updated_at=? WHERE id=? AND status='pending'",(database.utcnow(),row['id']))


@celery_app.task(name='services.optimization.run',acks_late=True,reject_on_worker_lost=True)
def run_job(id):
    with database.connect(immediate=True) as conn:
        job=conn.execute('SELECT * FROM optimization_jobs WHERE id=?',(id,)).fetchone()
        if not job or job['status'] not in ('queued','pending'): return
        conn.execute("UPDATE optimization_jobs SET status='running',attempts=attempts+1,updated_at=? WHERE id=?",(database.utcnow(),id))
        attempt=job['attempts']+1
        events=clean_history(conn,job['learner_id'],job['mode']); stats=eligibility(events)
        candidate=conn.execute("SELECT * FROM parameter_versions WHERE learner_id=? AND mode=? AND status IN ('candidate','awaiting_validation') ORDER BY created_at DESC LIMIT 1",(job['learner_id'],job['mode'])).fetchone()
        baseline=s.active_parameters(conn,job['learner_id'],job['mode'])
    try:
        if candidate:
            report=json.loads(candidate['report_json'])
            if report.get('baseline_id')!=baseline['id']:
                raise ValueError('Candidate baseline changed; request a new fit')
            result=compare(events,json.loads(candidate['parameters_json']),json.loads(baseline['parameters_json']),candidate['training_cutoff'])
            with database.connect(immediate=True) as conn:
                assert_frozen_history(conn,job,events,baseline,attempt)
                latest=conn.execute('SELECT status FROM parameter_versions WHERE id=?',(candidate['id'],)).fetchone()
                if latest[0]=='invalidated': raise ValueError('Training history changed while validation ran')
                report['validation']=result
                report['validation_snapshot_hash']=history_hash(events)
                report['reporting']={'status':'awaiting_next_100_outcomes','used_for_activation':False}
                conn.execute('UPDATE parameter_versions SET status=?,validation_cutoff=?,report_json=? WHERE id=?',(result['status'],max(e['at'] for e in events),json.dumps(report),candidate['id']))
                parameter_id=candidate['id']
                result['baseline_id']=baseline['id']
        elif not stats['eligible']:
            result={'status':'insufficient_data','counts':stats};parameter_id=None
        else:
            process=run_fit_process(events)
            if process.returncode: raise RuntimeError('Optimizer process failed: '+process.stderr[-1500:])
            result=json.loads(process.stdout);parameter_id=None
            if result['status']=='candidate':
                parameter_id=str(uuid4());cutoff=max(e['at'] for e in events)
                result['snapshot_hash']=history_hash(events);result['receipt_cutoff']=database.utcnow();result['baseline_id']=baseline['id'];result['training_ids']=[e['id'] for e in events]
                with database.connect(immediate=True) as conn:
                    assert_frozen_history(conn,job,events,baseline,attempt)
                    conn.execute('INSERT INTO parameter_versions(id,learner_id,mode,parameters_json,algorithm_version,status,created_at,training_cutoff,report_json) VALUES(?,?,?,?,?,?,?,?,?)',(parameter_id,job['learner_id'],job['mode'],json.dumps(result['parameters']),s.ALGORITHM,'candidate',database.utcnow(),cutoff,json.dumps(result)))
        with database.connect() as conn: conn.execute("UPDATE optimization_jobs SET status='complete',updated_at=?,result_json=?,parameter_version=? WHERE id=? AND status='running' AND attempts=?",(database.utcnow(),json.dumps(result),parameter_id,id,attempt))
    except Exception as exc:
        with database.connect() as conn:conn.execute("UPDATE optimization_jobs SET status='failed',updated_at=?,error=? WHERE id=? AND status='running' AND attempts=?",(database.utcnow(),str(exc)[:2000],id,attempt))
