from datetime import datetime,timedelta,timezone
from services.optimization import eligibility,eligible,compare
from fsrs import Scheduler


def events(cards=40,days=16):
    start=datetime(2025,1,1,tzinfo=timezone.utc)
    return [{'id':f'{day}-{card}','card_id':card,'at':(start+timedelta(days=day*2)).isoformat(),'rating':1 if (card+day)%7==0 else 3} for day in range(days) for card in range(cards)]


def test_optimizer_counts_elapsed_days_and_truncates_first_64():
    data=events();assert eligibility(data)['eligible']
    assert eligibility(data[:100])['eligible'] is False
    assert len(eligible(events(1,70)))==63
    same_day=[{**e,'at':'2025-01-01T01:00:00+00:00'} for e in data]
    assert eligibility(same_day)['outcomes']==0


def test_equal_candidate_cannot_pass_activation():
    data=events()
    result=compare(data,list(Scheduler().parameters),list(Scheduler().parameters),'2025-01-01T00:00:00+00:00')
    assert result['status']=='rejected'
    assert result['activate'] is False


def test_reporting_window_is_next_100_and_cannot_activate():
    data=events()
    result=compare(data,list(Scheduler().parameters),list(Scheduler().parameters),'2025-01-15T00:00:00+00:00',max_outcomes=100,reporting_only=True)
    assert result['status']=='reported'
    assert result['counts']['outcomes']==100
    assert result['activate'] is False and result['used_for_activation'] is False
    assert result['outcome_ids']==[e['id'] for e in sorted([e for e in data if e['at']>'2025-01-15T00:00:00+00:00'],key=lambda e:e['at'])[:100]]


def test_simultaneous_outcomes_keep_authoritative_input_order():
    import pytest
    from fsrs import Card, Rating
    from services.optimization import predictions
    from services.scheduling import moment
    # Device ordering deliberately conflicts with lexical UUID ordering.
    data=[
        {'id':'start','card_id':1,'at':'2025-01-01T00:00:00+00:00','rating':3},
        {'id':'z-first','card_id':1,'at':'2025-01-03T00:00:00+00:00','rating':1},
        {'id':'a-second','card_id':1,'at':'2025-01-03T00:00:00+00:00','rating':3},
        {'id':'later','card_id':1,'at':'2025-01-05T00:00:00+00:00','rating':3},
    ]
    assert [e['id'] for e in eligible(data)]==['z-first','later']
    engine=Scheduler(enable_fuzzing=False)
    card=Card(card_id=1,due=moment(data[0]['at']))
    for event in data[:3]:
        card,_=engine.review_card(card,Rating(event['rating']),review_datetime=moment(event['at']))
    expected=float(engine.get_card_retrievability(card,current_datetime=moment(data[-1]['at'])))
    actual=predictions(data,list(engine.parameters),data[0]['at'])
    assert list(actual)==['z-first','later']
    assert actual['later']['probability']==pytest.approx(expected)


def test_optimizer_child_keeps_lease_after_worker_death(tmp_path):
    import fcntl
    import os
    from pathlib import Path
    import signal
    import subprocess
    import sys
    import time
    import pytest
    # A lightweight executable substitutes for training, retaining the actual
    # inherited FD from run_fit_process across parent process death.
    child_script=tmp_path/'trainer'
    child_script.write_text(f'#!{sys.executable}\nimport os,signal,time\nfrom pathlib import Path\nsignal.alarm(10)\nPath(os.environ["CHILD_READY"]).write_text(str(os.getpid()))\ntime.sleep(10)\n')
    child_script.chmod(0o700)
    ready=tmp_path/'ready'
    env={**os.environ,'RECALLX_DATA_DIR':str(tmp_path),'RECALLX_OPTIMIZER_PYTHON':str(child_script),'CHILD_READY':str(ready)}
    parent=subprocess.Popen([sys.executable,'-c','from services.optimization_tasks import run_fit_process; run_fit_process([])'],env=env,cwd=Path(__file__).parents[1],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    child_pid=None
    try:
        deadline=time.monotonic()+5
        while not ready.exists():
            assert parent.poll() is None
            assert time.monotonic()<deadline
            time.sleep(.02)
        child_pid=int(ready.read_text())
        parent.kill();parent.wait(timeout=5)
        with (tmp_path/'inference.lock').open('a') as lock:
            with pytest.raises(BlockingIOError):
                fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
            os.kill(child_pid,signal.SIGKILL)
            child_pid=None
            deadline=time.monotonic()+5
            while True:
                try:
                    fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    assert time.monotonic()<deadline
                    time.sleep(.02)
    finally:
        if parent.poll() is None:parent.kill();parent.wait(timeout=5)
        if child_pid is not None:
            try:os.kill(child_pid,signal.SIGKILL)
            except ProcessLookupError:pass


def test_standalone_optimizer_alarm_bounds_an_orphan_waiting_for_input():
    from pathlib import Path
    import signal
    import subprocess
    import sys
    # Shorten only the expected production alarm in this subprocess; the
    # production entry point must arm it before attempting to read stdin.
    script='import runpy,signal; alarm=signal.alarm; signal.alarm=lambda seconds: alarm(1 if seconds==900 else seconds); runpy.run_module("services.optimization",run_name="__main__")'
    child=subprocess.Popen([sys.executable,'-c',script],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=Path(__file__).parents[1])
    try:
        assert child.wait(timeout=5)==-signal.SIGALRM
    finally:
        if child.poll() is None:child.kill();child.wait(timeout=5)
        child.stdin.close();child.stdout.close();child.stderr.close()


def test_enqueue_alias_is_durable_after_existing_job_finishes(tmp_path,monkeypatch):
    import uuid
    from types import SimpleNamespace
    import pytest
    from fastapi import HTTPException
    import database
    from routers.optimization import FitRequest, enqueue
    monkeypatch.setenv('RECALLX_DB_PATH',str(tmp_path/'optimizer.sqlite'))
    database.init_db()
    original=str(uuid.uuid4())
    old_time='2025-01-01T00:00:00+00:00'
    with database.connect() as conn:
        conn.execute('INSERT INTO optimization_jobs(id,learner_id,mode,status,created_at,updated_at) VALUES(?,?,?,?,?,?)',(original,'personal','flashcard','pending',old_time,old_time))
    request=SimpleNamespace(state=SimpleNamespace(learner_id='personal'))
    alias=FitRequest(id=uuid.uuid4(),mode='flashcard')
    first=enqueue(alias,request)
    assert first['id']==original
    with database.connect() as conn:
        conn.execute("UPDATE optimization_jobs SET status='complete' WHERE id=?",(original,))
    assert enqueue(alias,request)==first
    with database.connect() as conn:
        assert conn.execute('SELECT COUNT(*) FROM optimization_jobs').fetchone()[0]==1
        assert conn.execute('SELECT kind FROM operations WHERE id=?',(str(alias.id),)).fetchone()[0]=='optimization_enqueue'
    with pytest.raises(HTTPException) as collision:
        enqueue(FitRequest(id=alias.id,mode='recall'),request)
    assert collision.value.status_code==409
