from datetime import datetime, timedelta, timezone
import json
import hashlib
from typing import Literal
from uuid import UUID, uuid4
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
import database
from services import scheduling as s
from services.optimization import clean_history,eligibility,eligible,compare

router=APIRouter(prefix='/optimizations',tags=['optimization'])


def frozen_validation_valid(version,report,events):
    if not version['validation_cutoff']:return False
    frozen=[e for e in events if e['at']<=version['validation_cutoff']]
    digest=hashlib.sha256(json.dumps(frozen,sort_keys=True).encode()).hexdigest()
    return digest==report.get('validation_snapshot_hash')


class FitRequest(BaseModel):
    id:UUID
    mode:Literal['recall','flashcard']


@router.get('')
def status(request:Request):
    learner=request.state.learner_id
    with database.connect() as conn:
        return {'eligibility':{mode:eligibility(clean_history(conn,learner,mode)) for mode in ('recall','flashcard')},'jobs':[dict(r) for r in conn.execute('SELECT * FROM optimization_jobs WHERE learner_id=? ORDER BY created_at DESC LIMIT 20',(learner,))],'parameters':[dict(r) for r in conn.execute('SELECT * FROM parameter_versions WHERE learner_id=?',(learner,))]}


@router.get('/{parameter_version}/report')
def prospective_report(parameter_version:str,request:Request):
    """The next 100 outcomes after frozen validation are for reporting only."""
    with database.connect() as conn:
        version=conn.execute('SELECT * FROM parameter_versions WHERE id=? AND learner_id=?',(parameter_version,request.state.learner_id)).fetchone()
        if not version: raise HTTPException(404,'Parameter version not found')
        if not version['validation_cutoff'] or version['status']=='invalidated':
            return {'status':'unavailable','reason':'Requires valid frozen validation evidence','used_for_activation':False}
        report=json.loads(version['report_json'])
        baseline=conn.execute('SELECT * FROM parameter_versions WHERE id=?',(report.get('baseline_id'),)).fetchone()
        if not baseline: raise HTTPException(409,'Recorded baseline unavailable')
        events=clean_history(conn,request.state.learner_id,version['mode'])
        if not frozen_validation_valid(version,report,events):
            return {'status':'unavailable','reason':'Frozen validation history changed','used_for_activation':False}
    result=compare(events,json.loads(version['parameters_json']),json.loads(baseline['parameters_json']),version['validation_cutoff'],max_outcomes=100,reporting_only=True)
    result['used_for_activation']=False
    return result


@router.post('',status_code=202)
def enqueue(req:FitRequest,request:Request):
    learner=request.state.learner_id
    with database.connect(immediate=True) as conn:
        prior=conn.execute('SELECT * FROM operations WHERE id=?',(str(req.id),)).fetchone()
        if prior:
            if prior['kind']!='optimization_enqueue' or prior['learner_id']!=learner or prior['payload_json']!=req.model_dump_json():
                raise HTTPException(409,'Operation ID collision')
            return json.loads(prior['response_json'])
        def remember(job):
            result=dict(job)
            conn.execute('INSERT INTO operations VALUES(?,?,?,?,?,?)',(str(req.id),learner,'optimization_enqueue',database.utcnow(),req.model_dump_json(),json.dumps(result)))
            return result
        old=conn.execute('SELECT * FROM optimization_jobs WHERE id=?',(str(req.id),)).fetchone()
        if old:
            if old['learner_id']!=learner or old['mode']!=req.mode: raise HTTPException(409,'Job ID collision')
            return remember(old)
        history=clean_history(conn,learner,req.mode)
        stats=eligibility(history)
        last=conn.execute('SELECT * FROM optimization_jobs WHERE learner_id=? AND mode=? ORDER BY created_at DESC LIMIT 1',(learner,req.mode)).fetchone()
        if last and last['status'] in ('pending','queued','running'): return remember(last)
        if last and last['status']=='complete' and s.moment(last['created_at'])>datetime.now(timezone.utc)-timedelta(days=7): raise HTTPException(409,'Fit jobs run at most weekly')
        previous=conn.execute("SELECT * FROM parameter_versions WHERE learner_id=? AND mode=? AND training_cutoff IS NOT NULL ORDER BY created_at DESC LIMIT 1",(learner,req.mode)).fetchone()
        if previous and previous['status'] not in ('candidate','awaiting_validation','invalidated'):
            new_outcomes=[e for e in eligible(history) if s.moment(e['at'])>s.moment(previous['training_cutoff'])]
            if len(new_outcomes)<100: raise HTTPException(409,'Collect at least 100 new eligible outcomes before another fit')
        state='pending' if stats['eligible'] else 'insufficient_data'
        conn.execute('INSERT INTO optimization_jobs(id,learner_id,mode,status,created_at,updated_at,result_json) VALUES(?,?,?,?,?,?,?)',(str(req.id),learner,req.mode,state,database.utcnow(),database.utcnow(),json.dumps({'counts':stats})))
        return remember(conn.execute('SELECT * FROM optimization_jobs WHERE id=?',(str(req.id),)).fetchone())


class Activation(BaseModel):
    id:UUID
    parameter_version:str


@router.post('/activate')
def activate(req:Activation,request:Request):
    learner=request.state.learner_id
    with database.connect(immediate=True) as conn:
        prior=conn.execute('SELECT * FROM operations WHERE id=?',(str(req.id),)).fetchone()
        if prior:
            if prior['kind']!='parameter_activation' or prior['learner_id']!=learner or prior['payload_json']!=req.model_dump_json(): raise HTTPException(409,'Operation ID collision')
            return json.loads(prior['response_json'])
        version=conn.execute("SELECT * FROM parameter_versions WHERE id=? AND learner_id=? AND status IN ('validated','previous')",(req.parameter_version,learner)).fetchone()
        if not version: raise HTTPException(409,'Only validated or previously active parameters may be activated')
        old=s.active_parameters(conn,learner,version['mode'])
        if version['status']=='validated':
            report=json.loads(version['report_json'])
            if report.get('baseline_id')!=old['id']: raise HTTPException(409,'The active baseline changed; validate a new candidate')
            if not frozen_validation_valid(version,report,clean_history(conn,learner,version['mode'])): raise HTTPException(409,'Frozen validation history changed; validate a new candidate')
        conn.execute("UPDATE parameter_versions SET status='previous' WHERE learner_id=? AND mode=? AND status='active'",(learner,version['mode']))
        conn.execute("UPDATE parameter_versions SET status='active',activated_at=? WHERE id=?",(database.utcnow(),version['id']))
        for state in conn.execute('SELECT * FROM memory_states WHERE learner_id=? AND mode=?',(learner,version['mode'])).fetchall(): s.replay(conn,learner,state['item_id'],state['mode'],candidate_version=version['id'],preserve_due=True)
        conn.execute('INSERT INTO parameter_activations VALUES(?,?,?,?,?,?,?)',(str(uuid4()),learner,version['mode'],old['id'],version['id'],database.utcnow(),'validated_activation_or_rollback'))
        result={'status':'active','parameter_version':version['id'],'due_dates':'preserved_until_next_review'}
        conn.execute('INSERT INTO operations VALUES(?,?,?,?,?,?)',(str(req.id),learner,'parameter_activation',database.utcnow(),req.model_dump_json(),json.dumps(result)))
        return result
