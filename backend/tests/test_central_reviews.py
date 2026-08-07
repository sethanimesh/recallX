from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timedelta,timezone
import json
import uuid
import pytest
from fastapi.testclient import TestClient
import database
from main import app


@pytest.fixture
def api(tmp_path,monkeypatch):
    monkeypatch.setattr(database,'_DEFAULT_DB_PATH',str(tmp_path/'central.sqlite'))
    monkeypatch.setenv('RECALLX_DISABLE_DISPATCH','1')
    monkeypatch.setenv('RECALLX_BOOTSTRAP_SECRET','test-bootstrap-secret')
    database.init_db()
    with TestClient(app) as client:
        token=client.post('/pairing/bootstrap',json={'bootstrap_secret':'test-bootstrap-secret','device_name':'Test device'}).json()['token']
        client.headers['Authorization']='Bearer '+token
        response=client.post('/words',json={'id':'item-a','word':'ephemeral','definition':'lasting a short time','example_sentence':'Brief joy','created_at':1,'updated_at':1})
        assert response.status_code==201,response.text
        yield client


def payload(**updates):
    result={'id':str(uuid.uuid4()),'item_id':'item-a','mode':'flashcard','answered_at':datetime.now(timezone.utc).isoformat(),'device_sequence':1,'content_revision':1,'progress_generation':1,'rating':3,'revealed':True}
    result.update(updates);return result


def test_review_is_atomic_and_retry_is_idempotent(api):
    data=payload();first=api.post('/reviews',json=data)
    assert first.status_code==200,first.text
    assert first.json()['status']=='acknowledged'
    assert api.post('/reviews',json=data).json()==first.json()
    with database.connect() as conn:
        assert conn.execute('SELECT COUNT(*) FROM review_events').fetchone()[0]==1
        assert conn.execute("SELECT state_version FROM memory_states WHERE mode='flashcard'").fetchone()[0]==1
    data['rating']=1
    assert api.post('/reviews',json=data).status_code==409


def test_two_concurrent_reviews_are_serialized(api):
    data=payload()
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses=list(pool.map(lambda _:api.post('/reviews',json=data),range(2)))
    assert [r.status_code for r in responses]==[200,200]
    assert responses[0].json()==responses[1].json()


def test_out_of_order_offline_review_replays(api):
    now=datetime.now(timezone.utc)
    late=payload(device_sequence=2,answered_at=now.isoformat(),rating=3)
    early=payload(device_sequence=1,answered_at=(now-timedelta(days=3)).isoformat(),rating=1,offline=True)
    assert api.post('/reviews',json=late).status_code==200
    response=api.post('/reviews',json=early)
    assert response.json()['status']=='acknowledged'
    assert response.json()['memory_state']['card']['last_review']==now.isoformat()
    assert response.json()['memory_state']['state_version']==2


def test_reset_prevents_delayed_resurrection(api):
    assert api.post('/reviews',json=payload()).status_code==200
    reset={'id':str(uuid.uuid4()),'expected_generation':1}
    response=api.post('/progress/reset',json=reset)
    assert response.json()['progress_generation']==2
    assert api.post('/progress/reset',json=reset).json()==response.json()
    late=api.post('/reviews',json=payload(device_sequence=2))
    assert late.json()['status']=='practice'
    assert late.json()['reason']=='obsolete_progress_generation'
    assert late.json()['memory_state']['card']['last_review'] is None


def test_modes_and_uncertainty_do_not_change_memory(api):
    attempt=str(uuid.uuid4())
    grade=api.post('/assessments',json={'item_id':'item-a','content_revision':1,'attempt_id':attempt,'answer':'temporary'})
    assert grade.status_code==200,grade.text
    assert grade.json()['decision']=='uncertain'
    response=api.post('/reviews',json=payload(mode='recall',assessment_id=attempt,rating=None,revealed=False))
    assert response.json()['status']=='practice'
    assert response.json()['memory_state']['state_version']==0
    assert api.post('/reviews',json=payload(device_sequence=2)).json()['status']=='acknowledged'
    snapshot=api.get('/sync/snapshot').json()
    assert next(s for s in snapshot['memory_states'] if s['mode']=='recall')['card']['last_review'] is None


def test_pairing_revocation_and_authenticated_legacy_routes(api):
    assert TestClient(app).get('/words').status_code==401
    pair=TestClient(app).post('/pairing/start',json={'device_name':'TV'}).json()
    assert api.post('/pairing/approve',json={'code':pair['code']}).status_code==200
    session=TestClient(app).get('/pairing/'+pair['id'],params={'poll_token':pair['poll_token']}).json()
    other=TestClient(app,headers={'Authorization':'Bearer '+session['token']})
    assert other.get('/sync/snapshot').status_code==200
    assert api.delete('/pairing/devices/'+session['device_id']).status_code==200
    assert other.get('/words').status_code==401


def test_content_edits_and_tombstones_keep_history(api):
    assert api.post('/reviews',json=payload()).status_code==200
    changed=api.patch('/words/item-a',json={'definition':'lasting only briefly','expected_content_revision':1})
    assert changed.json()['content_revision']==2
    stale=api.post('/reviews',json=payload(device_sequence=2))
    assert stale.json()['reason']=='obsolete_content_revision'
    api.delete('/words/item-a')
    snapshot=api.get('/sync/snapshot').json()
    assert snapshot['words'][0]['deleted_at'] is not None
    assert len(snapshot['reviews'])==2
    with database.connect() as conn:
        with pytest.raises(Exception,match='immutable'):conn.execute('DELETE FROM review_events')


def test_retention_change_preserves_due_until_next_review(api):
    first=api.post('/reviews',json=payload()).json()['memory_state']['due']
    assert api.patch('/settings',json={'expected_revision':1,'desired_retention':.95}).status_code==200
    snap=api.get('/sync/snapshot').json()
    assert next(s for s in snap['memory_states'] if s['mode']=='flashcard')['due']==first


def test_delayed_review_uses_recorded_configuration_and_settings_retry(api):
    snapshot=api.get('/sync/snapshot').json()
    parameter=next(p['id'] for p in snapshot['parameter_versions'] if p['mode']=='flashcard')
    change={'id':str(uuid.uuid4()),'expected_revision':1,'desired_retention':.95}
    first=api.patch('/settings',json=change)
    assert first.status_code==200
    assert api.patch('/settings',json=change).json()==first.json()
    response=api.post('/reviews',json=payload(offline=True,settings_revision=1,parameter_version=parameter))
    assert response.json()['status']=='acknowledged'
    with database.connect() as conn:
        row=conn.execute('SELECT desired_retention,settings_revision FROM review_events').fetchone()
        assert row['desired_retention']==.9 and row['settings_revision']==1
        assert conn.execute('SELECT COUNT(*) FROM settings_revisions').fetchone()[0]==2


def test_unrevealed_flashcard_and_stale_rubric_are_practice(api):
    assert api.post('/reviews',json=payload(revealed=False)).json()['reason']=='flashcard_not_revealed'
    attempt=str(uuid.uuid4())
    with database.connect() as conn:
        conn.execute("UPDATE rubrics SET status='approved' WHERE item_id='item-a'")
        revision=conn.execute("SELECT revision FROM rubrics WHERE item_id='item-a'").fetchone()[0]
        conn.execute('INSERT INTO assessments(id,learner_id,item_id,content_revision,rubric_revision,decision,experimental,assisted,created_at,response_json,request_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(attempt,'personal','item-a',1,revision,'correct',0,0,1,'{"mode":"recall"}','test'))
        from assessment.rubrics import create_draft
        create_draft(conn,'item-a','lasting only briefly')
        conn.execute("UPDATE rubrics SET status='approved' WHERE item_id='item-a'")
    response=api.post('/reviews',json=payload(mode='recall',assessment_id=attempt,device_sequence=2,revealed=False))
    assert response.json()['reason']=='obsolete_rubric_revision'
    assert response.json()['memory_state']['state_version']==0


def test_correction_id_cannot_target_another_review(api):
    first=api.post('/reviews',json=payload()).json()['id']
    second=api.post('/reviews',json=payload(device_sequence=2)).json()['id']
    correction={'id':str(uuid.uuid4()),'rating':1,'reason':'Accidental button'}
    assert api.post(f'/reviews/{first}/corrections',json=correction).status_code==200
    assert api.post(f'/reviews/{first}/corrections',json=correction).status_code==200
    assert api.post(f'/reviews/{second}/corrections',json=correction).status_code==409


def test_export_contains_immutable_learning_evidence_not_credentials(api):
    api.post('/reviews',json=payload())
    response=api.get('/export')
    assert response.status_code==200,response.text
    export=response.json()
    assert len(export['review_events'])==1
    assert len(export['memory_states'])==2
    assert export['rubrics'] and export['parameter_versions']
    assert export['evidence']['synthetic_demo_included'] is False
    assert export['evidence']['asset_bytes_included'] is False
    assert 'devices' not in export and 'pairing_requests' not in export


def test_parameter_activation_preserves_due_retries_and_rolls_back(api):
    import hashlib
    from services.optimization import clean_history
    now=datetime.now(timezone.utc)
    original=api.post('/reviews',json=payload(answered_at=now.isoformat())).json()['memory_state']
    with database.connect() as conn:
        baseline=conn.execute("SELECT * FROM parameter_versions WHERE mode='flashcard' AND status='active'").fetchone()
        events=clean_history(conn,'personal','flashcard')
        report={'baseline_id':baseline['id'],'validation_snapshot_hash':hashlib.sha256(json.dumps(events,sort_keys=True).encode()).hexdigest()}
        conn.execute('INSERT INTO parameter_versions(id,learner_id,mode,parameters_json,algorithm_version,status,created_at,training_cutoff,validation_cutoff,report_json) VALUES(?,?,?,?,?,?,?,?,?,?)',('test-candidate','personal','flashcard',baseline['parameters_json'],baseline['algorithm_version'],'validated',database.utcnow(),(now-timedelta(days=20)).isoformat(),now.isoformat(),json.dumps(report)))
    request={'id':str(uuid.uuid4()),'parameter_version':'test-candidate'}
    receipt=api.post('/optimizations/activate',json=request)
    assert receipt.status_code==200,receipt.text
    assert api.post('/optimizations/activate',json=request).json()==receipt.json()
    snapshot=api.get('/sync/snapshot').json()
    state=next(s for s in snapshot['memory_states'] if s['mode']=='flashcard')
    assert state['due']==original['due'] and state['parameter_version']=='test-candidate'
    assert api.post('/optimizations/activate',json={**request,'parameter_version':baseline['id']}).status_code==409
    rollback=api.post('/optimizations/activate',json={'id':str(uuid.uuid4()),'parameter_version':baseline['id']})
    assert rollback.status_code==200,rollback.text
    state=next(s for s in api.get('/sync/snapshot').json()['memory_states'] if s['mode']=='flashcard')
    assert state['due']==original['due'] and state['parameter_version']==baseline['id']


def test_late_review_invalidates_frozen_validation(api):
    now=datetime.now(timezone.utc)
    with database.connect() as conn:
        parameter=conn.execute("SELECT * FROM parameter_versions WHERE mode='flashcard'").fetchone()
        conn.execute('INSERT INTO parameter_versions(id,learner_id,mode,parameters_json,algorithm_version,status,created_at,training_cutoff,validation_cutoff,report_json) VALUES(?,?,?,?,?,?,?,?,?,?)',('test-candidate','personal','flashcard',parameter['parameters_json'],parameter['algorithm_version'],'validated',database.utcnow(),(now-timedelta(days=30)).isoformat(),now.isoformat(),'{}'))
    api.post('/reviews',json=payload(answered_at=(now-timedelta(days=3)).isoformat(),offline=True))
    with database.connect() as conn:
        assert conn.execute("SELECT status FROM parameter_versions WHERE id='test-candidate'").fetchone()[0]=='invalidated'
    assert api.post('/optimizations/activate',json={'id':str(uuid.uuid4()),'parameter_version':'test-candidate'}).status_code==409


def test_review_after_activation_replays_its_recorded_parameters(api):
    from services import scheduling as s
    now=datetime.now(timezone.utc)
    with database.connect() as conn:
        baseline=conn.execute("SELECT * FROM parameter_versions WHERE mode='flashcard' AND status='active'").fetchone()
        conn.execute("UPDATE parameter_versions SET status='previous' WHERE id=?",(baseline['id'],))
        changed=json.loads(baseline['parameters_json']);changed[0]=changed[0]*2
        conn.execute('INSERT INTO parameter_versions(id,learner_id,mode,parameters_json,algorithm_version,status,created_at,activated_at) VALUES(?,?,?,?,?,?,?,?)',('activated-test','personal','flashcard',json.dumps(changed),s.ALGORITHM,'active',database.utcnow(),database.utcnow()))
        conn.execute('INSERT INTO parameter_activations VALUES(?,?,?,?,?,?,?)',(str(uuid.uuid4()),'personal','flashcard',baseline['id'],'activated-test',(now-timedelta(days=1)).isoformat(),'fixture_activation'))
    # This cached device answered after activation without receiving the new preset.
    request=payload(answered_at=now.isoformat(),parameter_version=baseline['id'],offline=True)
    result=api.post('/reviews',json=request).json()
    assert result['status']=='acknowledged'
    assert result['memory_state']['parameter_version']==baseline['id']
    with database.connect() as conn:
        expected,_=s.scheduler(conn,baseline['id']).review_card(s.Card(card_id=result['memory_state']['card']['card_id'],due=now),s.Rating.Good,review_datetime=now)
    assert result['memory_state']['card']['stability']==expected.stability


def test_legacy_database_migration_preserves_ids_and_words(tmp_path):
    import sqlite3
    path=str(tmp_path/'old.sqlite')
    with sqlite3.connect(path) as conn:
        conn.execute('CREATE TABLE words(word TEXT PRIMARY KEY)')
        conn.execute("INSERT INTO words VALUES('legacy')")
    database.init_db(path)
    backups=list((tmp_path/'data'/'backups').glob('old-before-migration-*.sqlite'))
    assert len(backups)==1
    with sqlite3.connect(backups[0]) as conn:
        assert conn.execute('SELECT word FROM words').fetchone()[0]=='legacy'
        assert [r[1] for r in conn.execute('PRAGMA table_info(words)')]==['word']
    with database.connect(path) as conn:
        row=conn.execute('SELECT * FROM words').fetchone()
        assert row['word']=='legacy' and row['content_revision']==1
        id=row['id']
    database.init_db(path)
    with database.connect(path) as conn:assert conn.execute('SELECT id FROM words').fetchone()[0]==id
