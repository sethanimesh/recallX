import asyncio
import hashlib
import json
import logging
import os
from pathlib import Path
import sqlite3
import sys
import time

from fastapi import HTTPException

import database
from assessment.contracts import AssessmentRequest, AssessmentResult
from assessment.inference import MODEL_VERSIONS
from assessment.rubrics import canonical_item, record
from assessment.scoring import SCORER_VERSION, features, feedback, load_artifact, selective_decision

logger = logging.getLogger(__name__)
HINT_REQUESTS = {'hint','help','skip',"i don't know",'i don’t know','i do not know','पता नहीं','मदद','pata nahi','mujhe nahi pata','hint please'}


class ModelService:
    def __init__(self):
        self._lock = asyncio.Lock()
        self._process = None

    async def infer(self, **payload):
        try:
            await asyncio.wait_for(self._lock.acquire(),timeout=5)
        except asyncio.TimeoutError:
            return {'error':'model_unavailable'}
        try:
            try:
                return await asyncio.wait_for(self._infer(payload), timeout=float(os.getenv('RECALLX_GRADING_TIMEOUT','180')))
            except (asyncio.TimeoutError, BrokenPipeError, ConnectionResetError, OSError):
                await self.close()
                return {'error':'model_unavailable'}
            except asyncio.CancelledError:
                await self.close()
                raise
        finally:
            self._lock.release()

    async def _infer(self, payload):
        if self._process is None or self._process.returncode is not None:
            python = os.environ.get('RECALLX_GRADING_PYTHON', sys.executable)
            self._process = await asyncio.create_subprocess_exec(python,'-u','-m','assessment.worker',
                cwd=str(Path(__file__).resolve().parents[1]), stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
                limit=1024*1024,
                env={**os.environ,'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','TOKENIZERS_PARALLELISM':'false'})
        self._process.stdin.write((json.dumps(payload,ensure_ascii=False)+'\n').encode())
        await self._process.stdin.drain()
        line = await self._process.stdout.readline()
        if not line:
            await self.close()
            return {'error':'model_unavailable'}
        try:
            result=json.loads(line)
            if result.pop('retiring',False):
                await self.close()
            return result
        except (ValueError,UnicodeDecodeError):
            await self.close()
            return {'error':'model_unavailable'}

    async def close(self):
        process,self._process = self._process,None
        if process is not None and process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
            await process.wait()


models = ModelService()


def redact_raw_responses(conn,learner_id,assessment_id=None):
    """Delete raw answers and verbatim spans, retaining numeric evidence and review facts."""
    if assessment_id:
        rows=conn.execute('SELECT id,response_json FROM assessments WHERE learner_id=? AND id=?',(learner_id,assessment_id)).fetchall()
    else:
        rows=conn.execute('SELECT id,response_json FROM assessments WHERE learner_id=? AND raw_expires_at IS NOT NULL AND raw_expires_at<=?',(learner_id,int(time.time()*1000))).fetchall()
    for row in rows:
        response=json.loads(row['response_json'])
        for concept in response.get('concept_results',[]):
            concept['evidence_span']='[response removed]'
            concept['contradiction_span']=None
        conn.execute('UPDATE assessments SET answer_text=NULL,raw_expires_at=NULL,response_json=? WHERE id=?',
                     (json.dumps(response,ensure_ascii=False),row['id']))
    return len(rows)


def experimental_setting(conn, learner_id):
    row = conn.execute('SELECT experimental_grading FROM learner_settings WHERE learner_id=?',(learner_id,)).fetchone()
    return bool(row and row[0])


async def assess(request: AssessmentRequest, learner_id='personal', mode='recall'):
    ident = str(request.attempt_id)
    request_data = request.model_dump(mode='json')
    request_data['mode'] = mode
    digest = hashlib.sha256(json.dumps(request_data,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    with database.connect() as conn:
        redact_raw_responses(conn,learner_id)
        previous = conn.execute('SELECT * FROM assessments WHERE id=?',(ident,)).fetchone()
        if previous:
            if previous['learner_id'] != learner_id or previous['request_hash'] != digest:
                raise HTTPException(409,'Attempt ID already used with different content')
            return AssessmentResult.model_validate_json(previous['response_json'])
        item = canonical_item(conn,request.item_id,request.content_revision)
        rubric_row = conn.execute("SELECT * FROM rubrics WHERE item_id=? AND content_revision=? AND status='approved' ORDER BY revision DESC LIMIT 1",(request.item_id,request.content_revision)).fetchone()
        rubric = record(rubric_row) if rubric_row else None
        experimental_enabled = experimental_setting(conn,learner_id)
    versions = {**MODEL_VERSIONS,'scorer':SCORER_VERSION,'calibration':None,'device':os.getenv('RECALLX_GRADING_DEVICE','cpu')}
    artifact = load_artifact(os.getenv('RECALLX_CALIBRATION_PATH'), MODEL_VERSIONS)
    if artifact:
        versions['calibration'] = artifact.get('id')
    experimental = bool(artifact and artifact.get('experimental',True))
    results = []
    decision,confidence,reason = 'uncertain',None,'calibration_unavailable'
    answer = request.answer.strip()
    language = {'hinglish':'hi-Latn','hi-latn':'hi-Latn','hindi':'hi','english':'en'}.get(request.language.lower(),request.language)
    if not answer:
        reason = 'empty_answer'
    elif answer.lower().strip('.!?।').strip() in HINT_REQUESTS:
        reason = 'hint_request'
    elif not rubric:
        reason = 'rubric_not_approved'
    elif language not in ('en','hi','hi-Latn'):
        reason = 'unsupported_language'
    elif not artifact:
        reason = 'calibration_unavailable'
    elif [rubric['reference_language'],language] not in artifact.get('supported_language_pairs',[]):
        reason = 'unsupported_language_pair'
    elif experimental and not experimental_enabled:
        reason = 'experimental_disabled'
    elif not artifact.get('release_gates',{}).get(language,{}).get('passed'):
        reason = 'calibration_unavailable'
    else:
        prediction = await models.infer(answer=answer,word=item['word'],concepts=rubric['concepts'],rubric_key=f'{item["id"]}:{rubric["revision"]}')
        reason = prediction.get('error','calibrated')
        results = prediction.get('concept_results',[])
        if results:
            try:
                decision,confidence,reason = selective_decision(features(results),artifact,language)
            except (ValueError,KeyError,TypeError,OverflowError):
                results=[]
                decision,confidence,reason='uncertain',None,'model_unavailable'
    coverage = features(results)[0] if results else None
    result = AssessmentResult(id=ident,assessment_id=ident,item_id=request.item_id,mode=mode,
        content_revision=request.content_revision,rubric_revision=rubric['revision'] if rubric else None,
        decision=decision,feedback=feedback(decision,results,reason),reason=reason,coverage=coverage,
        confidence=confidence,experimental=experimental,assisted=request.assisted or reason=='hint_request',
        concept_results=results,versions=versions)
    now = int(time.time()*1000)
    retention_config=os.getenv('RECALLX_RAW_ANSWER_RETENTION_DAYS')
    retention_days=max(0,int(retention_config)) if retention_config is not None else None
    with database.connect(immediate=True) as conn:
        # Recheck and persist under one write reservation, preventing an intervening rubric edit.
        current = canonical_item(conn,request.item_id)
        approved = conn.execute("SELECT MAX(revision) FROM rubrics WHERE item_id=? AND content_revision=? AND status='approved'",(request.item_id,current['content_revision'])).fetchone()[0]
        if current['content_revision'] != request.content_revision or (rubric and approved != rubric['revision']):
            result.decision,result.reason = 'uncertain','content_changed'
            result.feedback = 'This meaning changed while the answer was being assessed. Reload it and try again.'
        try:
            conn.execute('''INSERT INTO assessments(id,learner_id,item_id,content_revision,rubric_revision,decision,experimental,assisted,created_at,response_json,request_hash,answer_text,answer_language,raw_expires_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                (ident,learner_id,request.item_id,request.content_revision,result.rubric_revision,result.decision,
                 int(result.experimental),int(result.assisted),now,result.model_dump_json(),digest,
                 request.answer if retention_days!=0 else None,language,
                 now+retention_days*86400000 if retention_days is not None else None))
        except sqlite3.IntegrityError:
            previous = conn.execute('SELECT * FROM assessments WHERE id=?',(ident,)).fetchone()
            if previous is None or previous['learner_id'] != learner_id or previous['request_hash'] != digest:
                raise HTTPException(409,'Attempt ID conflict')
            return AssessmentResult.model_validate_json(previous['response_json'])
    return result
