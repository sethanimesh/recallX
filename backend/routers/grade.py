import os
import json
import time
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import database
from assessment.contracts import AssessmentRequest, AssessmentResult, RubricInput, RubricRecord
from assessment.inference import MODEL_VERSIONS, EMBEDDING_ID, EMBEDDING_REVISION, NLI_ID, NLI_REVISION
from assessment.rubrics import canonical_item, create_draft, record
from assessment.scoring import SCORER_VERSION, load_artifact
from assessment.service import assess, redact_raw_responses

router = APIRouter()


@router.post('/grade', response_model=AssessmentResult)
@router.post('/assessments', response_model=AssessmentResult)
async def grade_answer(payload: AssessmentRequest, request: Request):
    return await assess(payload, getattr(request.state,'learner_id','personal'))


@router.get('/assessments/{assessment_id}', response_model=AssessmentResult)
def get_assessment(assessment_id: str, request: Request):
    with database.connect() as conn:
        redact_raw_responses(conn,getattr(request.state,'learner_id','personal'))
        row = conn.execute('SELECT response_json FROM assessments WHERE id=? AND learner_id=?',
                           (assessment_id,getattr(request.state,'learner_id','personal'))).fetchone()
    if not row:
        raise HTTPException(404,'Assessment not found')
    return AssessmentResult.model_validate_json(row[0])


@router.delete('/assessments/{assessment_id}/answer')
def delete_raw_response(assessment_id: str, request: Request):
    with database.connect() as conn:
        count=redact_raw_responses(conn,getattr(request.state,'learner_id','personal'),assessment_id)
    if not count:
        raise HTTPException(404,'Assessment not found')
    return {'assessment_id':assessment_id,'raw_response_deleted':True}


@router.get('/grading/readiness')
def readiness():
    artifact = load_artifact(os.getenv('RECALLX_CALIBRATION_PATH'),MODEL_VERSIONS)
    cache=Path(os.environ['HF_HOME'])/'hub'
    assets=all((cache/('models--'+name.replace('/','--'))/'snapshots'/revision/'model.safetensors').exists()
               for name,revision in ((EMBEDDING_ID,EMBEDDING_REVISION),(NLI_ID,NLI_REVISION)))
    return {'model_versions':MODEL_VERSIONS,'scorer':SCORER_VERSION,
            'calibration_ready':bool(artifact),'calibration_id':artifact.get('id') if artifact else None,
            'experimental':bool(artifact and artifact.get('experimental',True)),
            'local_checkpoint_files_present':assets,
            'languages':{lang:bool(artifact and artifact.get('release_gates',{}).get(lang,{}).get('passed')) for lang in ('en','hi','hi-Latn')},
            'supported_language_pairs':artifact.get('supported_language_pairs',[]) if artifact else [],
            'inference':'lazy; local checkpoints required','device':os.getenv('RECALLX_GRADING_DEVICE','cpu')}


@router.get('/items/{item_id}/rubrics', response_model=list[RubricRecord])
def get_rubrics(item_id: str):
    with database.connect() as conn:
        canonical_item(conn,item_id)
        return [record(row) for row in conn.execute('SELECT * FROM rubrics WHERE item_id=? ORDER BY revision DESC',(item_id,))]


@router.put('/items/{item_id}/rubric', response_model=RubricRecord)
def put_rubric(item_id: str, payload: RubricInput):
    with database.connect(immediate=True) as conn:
        canonical_item(conn,item_id,payload.content_revision)
        return create_draft(conn,item_id,'',payload.reference_language,
                            [c.model_dump() for c in payload.concepts],payload.content_revision,payload.operation_id)


class ApprovalRequest(BaseModel):
    operation_id: UUID | None = None
    content_revision: int = Field(ge=1)


@router.post('/items/{item_id}/rubrics/{revision}/approve', response_model=RubricRecord)
def approve_rubric(item_id: str, revision: int, payload: ApprovalRequest, request: Request):
    learner_id = getattr(request.state, 'learner_id', 'personal')
    operation_id = str(payload.operation_id) if payload.operation_id else None
    request_json = json.dumps({'item_id': item_id, 'revision': revision, **payload.model_dump(mode='json')}, sort_keys=True)
    with database.connect(immediate=True) as conn:
        if operation_id:
            prior = conn.execute('SELECT * FROM operations WHERE id=?', (operation_id,)).fetchone()
            if prior:
                if prior['learner_id'] != learner_id or prior['kind'] != 'rubric_approval' or prior['payload_json'] != request_json:
                    raise HTTPException(409, 'Rubric approval operation ID collision')
                return json.loads(prior['response_json'])
        canonical_item(conn,item_id,payload.content_revision)
        row = conn.execute('SELECT * FROM rubrics WHERE item_id=? AND revision=?',(item_id,revision)).fetchone()
        if not row:
            raise HTTPException(404,'Rubric not found')
        if row['content_revision'] != payload.content_revision or row['status']=='retired':
            raise HTTPException(409,'This rubric belongs to an old meaning or was retired')
        conn.execute("UPDATE rubrics SET status='retired' WHERE item_id=? AND status='approved' AND revision<>?",(item_id,revision))
        conn.execute("UPDATE rubrics SET status='approved',approved_at=COALESCE(approved_at,?) WHERE id=?",(int(time.time()*1000),row['id']))
        result = record(conn.execute('SELECT * FROM rubrics WHERE id=?',(row['id'],)).fetchone())
        if operation_id:
            conn.execute('INSERT INTO operations VALUES(?,?,?,?,?,?)', (operation_id, learner_id, 'rubric_approval',
                database.utcnow(), request_json, json.dumps(result)))
        return result
