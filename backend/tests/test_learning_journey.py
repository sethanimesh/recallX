"""Cross-service shipping flow; drafting is a fixture and semantic gates stay real."""
from datetime import datetime,timezone
from pathlib import Path
from uuid import uuid4
from unittest.mock import AsyncMock
import fitz
from fastapi.testclient import TestClient
import database
from main import app


def test_import_provenance_approval_abstention_review_and_second_device(tmp_path,monkeypatch):
    from ingestion import settings
    from ingestion.worker import process_job
    from assessment.service import models
    monkeypatch.setenv('RECALLX_DB_PATH',str(tmp_path/'journey.sqlite'))
    monkeypatch.setenv('RECALLX_DATA_DIR',str(tmp_path/'data'))
    monkeypatch.setenv('RECALLX_DISABLE_DISPATCH','1')
    monkeypatch.setenv('RECALLX_BOOTSTRAP_SECRET','journey-fixture-secret')
    monkeypatch.setenv('RECALLX_CALIBRATION_PATH',str(Path(__file__).parents[2]/'evaluation/grading/results/calibration/calibration.json'))
    monkeypatch.setattr(settings,'DATA_DIR',tmp_path/'assets')
    for key in ('OPENAI_API_KEY','GROQ_API_KEY','GEMINI_API_KEY','OPENROUTER_API_KEY','MISTRAL_API_KEY','HF_TOKEN'):
        monkeypatch.delenv(key,raising=False)
    infer=AsyncMock(side_effect=AssertionError('Failed frozen gates must not invoke models'))
    monkeypatch.setattr(models,'infer',infer)
    document=fitz.open();page=document.new_page()
    page.insert_text((30,40),'Ephemeral means lasting a short time. Lucid means clear and understandable.')
    raw=document.tobytes();document.close()
    with TestClient(app) as first:
        token=first.post('/pairing/bootstrap',json={'bootstrap_secret':'journey-fixture-secret','device_name':'Phone fixture'}).json()['token']
        first.headers['Authorization']='Bearer '+token
        upload=first.post('/ingestion/jobs',files={'file':('lesson.pdf',raw,'application/pdf')},data={'request_id':str(uuid4())})
        assert upload.status_code==202,upload.text
        job=upload.json()
        assert first.get('/ingestion/sources/'+job['source_id']).content==raw
        process_job(job['id'],extractor=lambda text,instructions:[
            {'word':'ephemeral','definition':'Lasting for a short time.','example_sentence':'An ephemeral rainbow.'},
            {'word':'lucid','definition':'Clear and understandable.','example_sentence':'A lucid explanation.'}])
        ready=first.get('/ingestion/jobs/'+job['id']).json()
        assert ready['status']=='ready'
        assert first.get(f"/ingestion/jobs/{job['id']}/pages/1").json()['method']=='native-text'
        decisions=[{**{k:c[k] for k in ('id','word','definition','example_sentence')},'accept':c['word']=='ephemeral'} for c in ready['candidates']]
        approval={'request_id':str(uuid4()),'candidates':decisions}
        accepted=first.post(f"/ingestion/jobs/{job['id']}/approve",json=approval)
        assert accepted.status_code==200,accepted.text
        assert first.post(f"/ingestion/jobs/{job['id']}/approve",json=approval).json()==accepted.json()
        item=next(c['item_id'] for c in accepted.json()['items'] if c['accepted'])
        sources=first.get(f'/ingestion/items/{item}/sources').json()
        assert sources['sources'] and sources['sources'][0]['citations']
        rubrics=first.get(f'/items/{item}/rubrics').json()
        assert rubrics[0]['status']=='draft'
        assert first.post(f"/items/{item}/rubrics/{rubrics[0]['revision']}/approve",json={'content_revision':1}).status_code==200
        assert first.patch('/settings',json={'id':str(uuid4()),'expected_revision':1,'experimental_grading':True}).status_code==200
        attempt=str(uuid4())
        assessment=first.post('/assessments',json={'attempt_id':attempt,'item_id':item,'content_revision':1,'answer':'Lasting only a short time.','language':'en'})
        assert assessment.status_code==200,assessment.text
        assert assessment.json()['decision']=='uncertain' and assessment.json()['experimental'] is True
        common={'item_id':item,'answered_at':datetime.now(timezone.utc).isoformat(),'content_revision':1,'progress_generation':1}
        practice=first.post('/reviews',json={**common,'id':str(uuid4()),'mode':'recall','assessment_id':attempt,'device_sequence':1})
        assert practice.json()['status']=='practice' and practice.json()['memory_state']['state_version']==0
        review={**common,'id':str(uuid4()),'mode':'flashcard','rating':3,'revealed':True,'device_sequence':2}
        saved=first.post('/reviews',json=review).json()
        assert saved['status']=='acknowledged'
        assert first.post('/reviews',json=review).json()==saved
        with TestClient(app) as second:
            pair=second.post('/pairing/start',json={'device_name':'Browser fixture'}).json()
            assert first.post('/pairing/approve',json={'code':pair['code']}).status_code==200
            identity=second.get('/pairing/'+pair['id'],params={'poll_token':pair['poll_token']}).json()
            second.headers['Authorization']='Bearer '+identity['token']
            snapshot=second.get('/sync/snapshot').json()
            assert len(snapshot['words'])==1 and len(snapshot['reviews'])==2
            state=next(s for s in snapshot['memory_states'] if s['mode']=='flashcard')
            assert state['due']==saved['memory_state']['due'] and state['state_version']==1
        infer.assert_not_called()
        with database.connect() as conn:
            assert conn.execute('SELECT COUNT(*) FROM llm_calls').fetchone()[0]==0
            assert conn.execute("SELECT COUNT(*) FROM ingestion_candidates WHERE status='rejected'").fetchone()[0]==1
