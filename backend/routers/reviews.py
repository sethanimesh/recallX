"""Idempotent review commits, audited corrections and reset generations."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
from typing import Literal
from uuid import UUID
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
import database
from contracts import MemoryState
from services import scheduling as s

router=APIRouter(tags=['reviews'])


class ReviewSubmission(BaseModel):
    id: UUID
    item_id: str
    mode: Literal['recall','flashcard']
    answered_at: datetime
    device_sequence: int = Field(ge=0)
    content_revision: int = Field(ge=1)
    progress_generation: int = Field(ge=1)
    expected_state_version: int | None = None
    settings_revision: int | None = Field(default=None,ge=1)
    parameter_version: str | None = None
    rating: Literal[1,3] | None = None
    assessment_id: str | None = None
    assisted: bool = False
    revealed: bool = False
    offline: bool = False

    @field_validator('answered_at')
    @classmethod
    def utc(cls,value): return s.moment(value)


class ReviewResult(BaseModel):
    id: str
    status: Literal['acknowledged','practice']
    reason: str | None = None
    rating: int | None = None
    memory_state: MemoryState | None = None
    reconciled: bool = False


def payload_hash(req):
    return hashlib.sha256(json.dumps(req.model_dump(mode='json'),sort_keys=True,separators=(',',':')).encode()).hexdigest()


@router.post('/reviews',response_model=ReviewResult)
def submit(req: ReviewSubmission, request: Request):
    learner=request.state.learner_id; device=request.state.device_id
    identity=str(req.id); fingerprint=payload_hash(req); now=datetime.now(timezone.utc)
    with database.connect(immediate=True) as conn:
        existing=conn.execute('SELECT * FROM review_events WHERE id=?',(identity,)).fetchone()
        if existing:
            if existing['learner_id']!=learner or existing['payload_hash']!=fingerprint: raise HTTPException(409,'Operation ID already used with different content')
            op=conn.execute('SELECT response_json FROM operations WHERE id=?',(identity,)).fetchone()
            return json.loads(op[0])
        if conn.execute('SELECT 1 FROM operations WHERE id=?',(identity,)).fetchone():
            raise HTTPException(409,'Operation ID already used')
        item=conn.execute('SELECT * FROM words WHERE id=?',(req.item_id,)).fetchone()
        if not item: raise HTTPException(404,'Item not found')
        config=s.settings(conn,learner); s.ensure_cards(conn,req.item_id,learner)
        current_state=conn.execute('SELECT state_version FROM memory_states WHERE learner_id=? AND item_id=? AND mode=?',(learner,req.item_id,req.mode)).fetchone()[0]
        reconciled=req.expected_state_version is not None and req.expected_state_version!=current_state
        parameter=s.active_parameters(conn,learner,req.mode)
        recorded_config=config
        if req.settings_revision is not None:
            recorded_config=conn.execute('SELECT * FROM settings_revisions WHERE learner_id=? AND revision=?',(learner,req.settings_revision)).fetchone()
            if not recorded_config: raise HTTPException(409,'Unknown scheduling settings revision')
        if req.parameter_version is not None:
            parameter=conn.execute("SELECT * FROM parameter_versions WHERE id=? AND learner_id=? AND mode=? AND activated_at IS NOT NULL",(req.parameter_version,learner,req.mode)).fetchone()
            if not parameter: raise HTTPException(409,'Unknown or never-active scheduling parameter version')
        status='acknowledged'; reason=None; rating=req.rating; experimental=False
        if req.mode=='recall':
            if not req.assessment_id: raise HTTPException(422,'Recall requires a canonical assessment ID')
            assessment=conn.execute('SELECT * FROM assessments WHERE id=? AND learner_id=?',(req.assessment_id,learner)).fetchone()
            if not assessment: raise HTTPException(404,'Assessment not found')
            details=json.loads(assessment['response_json'])
            if assessment['item_id']!=req.item_id or assessment['content_revision']!=req.content_revision: raise HTTPException(409,'Assessment belongs to different content')
            if details.get('mode','recall')!='recall': raise HTTPException(422,'Tutor practice cannot become a scheduled review')
            previous=conn.execute('SELECT id FROM review_events WHERE learner_id=? AND assessment_id=?',(learner,req.assessment_id)).fetchone()
            if previous: raise HTTPException(409,{'message':'Assessment already submitted','review_id':previous[0]})
            decision=assessment['decision'];experimental=bool(assessment['experimental'])
            rating=3 if decision=='correct' else 1 if decision in ('partial','incorrect') else None
            if rating is None: status,reason='practice','uncertain_assessment'
            if assessment['assisted'] or req.revealed: status,reason='practice','assisted_recall'
            if experimental and not config['experimental_grading']: status,reason='practice','experimental_grading_disabled'
            approved=conn.execute("SELECT revision FROM rubrics WHERE item_id=? AND content_revision=? AND status='approved' ORDER BY revision DESC LIMIT 1",(req.item_id,item['content_revision'])).fetchone()
            if assessment['rubric_revision'] is not None and (not approved or assessment['rubric_revision']!=approved['revision']):
                status,reason='practice','obsolete_rubric_revision'
        elif rating is None:
            raise HTTPException(422,'Self-rated flashcards require Again (1) or Good (3)')
        elif not req.revealed:
            status,reason='practice','flashcard_not_revealed'
        if req.assisted: status,reason='practice','assisted'
        if item['deleted_at'] is not None: status,reason='practice','deleted_item'
        if req.progress_generation!=config['progress_generation']: status,reason='practice','obsolete_progress_generation'
        if req.content_revision!=item['content_revision']: status,reason='practice','obsolete_content_revision'
        if req.answered_at>now+timedelta(minutes=5) or req.answered_at.year<2000: status,reason='practice','clock_review_required'
        same_sequence=conn.execute('SELECT id FROM review_events WHERE device_id=? AND device_sequence=?',(device,req.device_sequence)).fetchone()
        lower=conn.execute('SELECT answered_at FROM review_events WHERE device_id=? AND device_sequence<? ORDER BY device_sequence DESC LIMIT 1',(device,req.device_sequence)).fetchone()
        upper=conn.execute('SELECT answered_at FROM review_events WHERE device_id=? AND device_sequence>? ORDER BY device_sequence LIMIT 1',(device,req.device_sequence)).fetchone()
        if same_sequence or (lower and s.moment(lower[0])>req.answered_at) or (upper and s.moment(upper[0])<req.answered_at): status,reason='practice','device_time_order_conflict'
        conn.execute('''INSERT INTO review_events(id,learner_id,item_id,mode,assessment_id,answered_at,received_at,device_id,device_sequence,rating,assisted,revealed,offline,content_revision,progress_generation,parameter_version,settings_revision,desired_retention,algorithm_version,status,reason,experimental,payload_hash,response_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',(identity,learner,req.item_id,req.mode,req.assessment_id,req.answered_at.isoformat(),now.isoformat(),device,req.device_sequence,rating,int(req.assisted),int(req.revealed),int(req.offline),req.content_revision,req.progress_generation,parameter['id'],recorded_config['revision'],recorded_config['desired_retention'],s.ALGORITHM,status,reason,int(experimental),fingerprint,'{}'))
        state=s.replay(conn,learner,req.item_id,req.mode) if status=='acknowledged' else s.state_dict(conn.execute('SELECT * FROM memory_states WHERE learner_id=? AND item_id=? AND mode=?',(learner,req.item_id,req.mode)).fetchone())
        result={'id':identity,'status':status,'reason':reason,'rating':rating,'memory_state':state,'reconciled':reconciled}
        conn.execute('INSERT INTO operations VALUES(?,?,?,?,?,?)',(identity,learner,'review',now.isoformat(),json.dumps(req.model_dump(mode='json')),json.dumps(result)))
        # A late event invalidates frozen fitting evidence rather than silently rewriting it.
        conn.execute("UPDATE parameter_versions SET status='invalidated' WHERE learner_id=? AND mode=? AND status IN ('candidate','awaiting_validation','validated') AND COALESCE(validation_cutoff,training_cutoff)>=?",(learner,req.mode,req.answered_at.isoformat()))
    return result


@router.get('/reviews/{id}',response_model=ReviewResult)
def get_review(id: str,request: Request):
    with database.connect() as conn:
        row=conn.execute("SELECT response_json FROM operations WHERE id=? AND learner_id=? AND kind='review'",(id,request.state.learner_id)).fetchone()
        if not row: raise HTTPException(404,'Review not received')
        return json.loads(row[0])


class Reset(BaseModel):
    id: UUID
    expected_generation: int


@router.post('/progress/reset')
def reset(req: Reset,request: Request):
    learner=request.state.learner_id
    with database.connect(immediate=True) as conn:
        previous=conn.execute('SELECT * FROM operations WHERE id=?',(str(req.id),)).fetchone()
        if previous:
            if previous['kind']!='reset' or previous['payload_json']!=req.model_dump_json(): raise HTTPException(409,'Operation ID collision')
            return json.loads(previous['response_json'])
        config=s.settings(conn,learner)
        if config['progress_generation']!=req.expected_generation: raise HTTPException(409,'Refresh settings before resetting')
        conn.execute('UPDATE learner_settings SET progress_generation=progress_generation+1,revision=revision+1 WHERE learner_id=?',(learner,))
        for state in conn.execute('SELECT * FROM memory_states WHERE learner_id=?',(learner,)).fetchall(): s.replay(conn,learner,state['item_id'],state['mode'])
        result=s.settings(conn,learner)
        conn.execute('INSERT INTO operations VALUES(?,?,?,?,?,?)',(str(req.id),learner,'reset',database.utcnow(),req.model_dump_json(),json.dumps(result)))
        return result


class Correction(BaseModel):
    id: UUID
    rating: Literal[1,3] | None
    reason: str = Field(min_length=1,max_length=2000)


@router.post('/reviews/{id}/corrections')
def correct(id: str,req: Correction,request: Request):
    learner=request.state.learner_id
    with database.connect(immediate=True) as conn:
        event=conn.execute("SELECT * FROM review_events WHERE id=? AND learner_id=? AND status='acknowledged'",(id,learner)).fetchone()
        if not event: raise HTTPException(404,'Accepted review not found')
        correction_payload=json.dumps({'event_id':id,**req.model_dump(mode='json')},sort_keys=True)
        old=conn.execute('SELECT response_json,payload_json,kind FROM operations WHERE id=?',(str(req.id),)).fetchone()
        if old:
            if old['kind']!='correction' or old['payload_json']!=correction_payload: raise HTTPException(409,'Correction ID collision')
            return json.loads(old['response_json'])
        conn.execute('INSERT INTO review_corrections VALUES(?,?,?,?,?,?)',(str(req.id),id,learner,req.rating,req.reason,database.utcnow()))
        result={'memory_state':s.replay(conn,learner,event['item_id'],event['mode'])}
        conn.execute('INSERT INTO operations VALUES(?,?,?,?,?,?)',(str(req.id),learner,'correction',database.utcnow(),correction_payload,json.dumps(result)))
        conn.execute("UPDATE parameter_versions SET status='invalidated' WHERE learner_id=? AND mode=? AND status IN ('candidate','awaiting_validation','validated')",(learner,event['mode']))
        return result
