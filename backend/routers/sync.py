from uuid import UUID
import json
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
import database
from contracts import MemoryState, ReviewEventSummary
from routers.words import WordRecord, TagInfo
from services import scheduling as s

router=APIRouter(tags=['sync'])


class Settings(BaseModel):
    learner_id: str = 'personal'
    desired_retention: float
    experimental_grading: bool
    revision: int
    progress_generation: int


class SettingsUpdate(BaseModel):
    id: UUID | None = None
    desired_retention: float | None = Field(default=None,ge=.70,le=.99)
    experimental_grading: bool | None = None
    expected_revision: int


@router.get('/settings',response_model=Settings)
def get_settings(request: Request):
    with database.connect() as conn: return s.settings(conn,request.state.learner_id)


@router.patch('/settings',response_model=Settings)
def update_settings(req: SettingsUpdate,request: Request):
    with database.connect(immediate=True) as conn:
        if req.id:
            prior=conn.execute('SELECT * FROM operations WHERE id=?',(str(req.id),)).fetchone()
            if prior:
                if prior['kind']!='settings' or prior['payload_json']!=req.model_dump_json(): raise HTTPException(409,'Settings operation ID collision')
                return json.loads(prior['response_json'])
        old=s.settings(conn,request.state.learner_id)
        desired=req.desired_retention if req.desired_retention is not None else old['desired_retention']
        experimental=int(req.experimental_grading) if req.experimental_grading is not None else old['experimental_grading']
        # Retrying an already-applied update after a lost response is harmless.
        if old['revision']!=req.expected_revision:
            if desired==old['desired_retention'] and experimental==old['experimental_grading']: return old
            raise HTTPException(409,'Settings changed; refresh before editing')
        conn.execute('UPDATE learner_settings SET desired_retention=?,experimental_grading=?,revision=revision+1 WHERE learner_id=?',(desired,experimental,request.state.learner_id))
        result=s.settings(conn,request.state.learner_id)
        if req.id:conn.execute('INSERT INTO operations VALUES(?,?,?,?,?,?)',(str(req.id),request.state.learner_id,'settings',database.utcnow(),req.model_dump_json(),json.dumps(result)))
        return result


class Snapshot(BaseModel):
    version:int
    server_time:str
    words:list[WordRecord]
    tags:list[TagInfo]
    memory_states:list[MemoryState]
    reviews:list[ReviewEventSummary]
    settings:Settings
    rubrics:list[dict]
    parameter_versions:list[dict]


@router.get('/sync/snapshot',response_model=Snapshot)
def snapshot(request: Request):
    learner=request.state.learner_id
    with database.connect(immediate=True) as conn:
        words=[dict(r) for r in conn.execute('SELECT * FROM words ORDER BY id')]
        for word in words:
            word['tags']=[dict(t) for t in conn.execute('SELECT t.id,t.name FROM tags t JOIN word_tags wt ON wt.tag_id=t.id WHERE wt.word_id=?',(word['id'],))]
            if word['deleted_at'] is None: s.ensure_cards(conn,word['id'],learner)
        states=[s.state_dict(r) for r in conn.execute('SELECT * FROM memory_states WHERE learner_id=?',(learner,))]
        for state in states:
            engine=s.scheduler(conn,state['parameter_version'],s.settings(conn,learner)['desired_retention'])
            state['retrievability']=engine.get_card_retrievability(s.Card.from_json(json.dumps(state['card'])))
        tables={r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        return {'version':conn.execute('SELECT revision FROM sync_meta WHERE id=1').fetchone()[0], 'server_time':database.utcnow(), 'words':words,'tags':[dict(r) for r in conn.execute('SELECT * FROM tags')], 'memory_states':states,'reviews':[dict(r) for r in conn.execute('SELECT id,item_id,mode,rating,answered_at,status,reason,assessment_id,experimental,progress_generation,device_id FROM review_events WHERE learner_id=? ORDER BY answered_at,id',(learner,))], 'settings':s.settings(conn,learner), 'rubrics':[dict(r) for r in conn.execute('SELECT * FROM rubrics')] if 'rubrics' in tables else [],'parameter_versions':[dict(r) for r in conn.execute('SELECT id,mode,status,algorithm_version,created_at,activated_at,report_json FROM parameter_versions WHERE learner_id=?',(learner,))]}


class LegacyArchive(BaseModel):
    id: UUID
    data: dict


@router.post('/sync/legacy-archive')
def archive(req: LegacyArchive,request: Request):
    data=json.dumps(req.data,sort_keys=True)
    if len(data)>10_000_000: raise HTTPException(413,'Archive too large')
    with database.connect(immediate=True) as conn:
        old=conn.execute('SELECT data_json FROM legacy_archives WHERE id=?',(str(req.id),)).fetchone()
        if old and old[0]!=data: raise HTTPException(409,'Archive ID collision')
        conn.execute('INSERT OR IGNORE INTO legacy_archives VALUES(?,?,?,?,?)',(str(req.id),request.state.learner_id,request.state.device_id,database.utcnow(),data))
    return {'status':'archived','eligible_for_fitting':False}


@router.get('/export')
def export_history(request: Request):
    """Consistent personal learning archive; device credentials are never exported."""
    learner=request.state.learner_id
    with database.connect() as conn:
        conn.execute('BEGIN')
        owned=('review_events','review_corrections','assessments','memory_states','settings_revisions',
               'parameter_versions','parameter_activations','optimization_jobs',
               'operations','legacy_archives','ingestion_sources','ingestion_jobs',
               'ingestion_approval_requests','ingestion_source_corrections')
        shared=('words','tags','word_tags','item_revisions','rubrics','item_sources',
                'ingestion_pages','ingestion_blocks','ingestion_stages','ingestion_candidates')
        result={'schema_version':1,'exported_at':database.utcnow(),
                'learner_id':learner,'settings':s.settings(conn,learner),
                'evidence':{'synthetic_demo_included':False,
                            'experimental_assessments':'Permanently marked experimental; excluded from trusted fitting',
                            'asset_bytes_included':False,
                            'asset_backup':'Preserve the server data directory alongside this JSON.'}}
        for table in owned:
            result[table]=[dict(r) for r in conn.execute(f'SELECT * FROM {table} WHERE learner_id=?',(learner,))]
        for table in shared:
            result[table]=[dict(r) for r in conn.execute(f'SELECT * FROM {table}')]
        for source in result['ingestion_sources']:
            source.pop('storage_path',None)
            source['download_url']=f"/ingestion/sources/{source['id']}"
        result['database_migrations']=[dict(r) for r in conn.execute('SELECT * FROM schema_migrations')]
        return result
