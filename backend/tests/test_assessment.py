import json
import uuid
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import database
from assessment import service
from assessment.inference import MODEL_VERSIONS
from assessment.scoring import FEATURE_NAMES, LABELS, SCORER_VERSION, features
from routers import grade, tutor


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('RECALLX_DB_PATH',str(tmp_path/'test.sqlite'))
    monkeypatch.delenv('RECALLX_CALIBRATION_PATH',raising=False)
    database.init_db()
    with database.connect() as conn:
        conn.execute('INSERT INTO words(id,word,definition,example_sentence,created_at,updated_at,sense_id) VALUES(?,?,?,?,?,?,?)',
                     ('item','ephemeral','lasting a short time','An ephemeral rainbow.',1,1,'sense'))
    app=FastAPI()
    app.include_router(grade.router)
    app.include_router(tutor.router)
    with TestClient(app) as client:
        yield client


def payload(**changes):
    return {'item_id':'item','answer':'temporary','attempt_id':str(uuid.uuid4()),'content_revision':1,**changes}


def approve(client):
    result=client.put('/items/item/rubric',json={'content_revision':1,'concepts':[{'id':'duration','text':'lasting a short time'}]})
    assert result.status_code==200,result.text
    revision=result.json()['revision']
    response=client.post(f'/items/item/rubrics/{revision}/approve',json={'content_revision':1})
    assert response.status_code==200,response.text


def artifact(tmp_path,monkeypatch,passed=True):
    data={'schema_version':1,'id':'test-artifact','scorer_version':SCORER_VERSION,'feature_names':FEATURE_NAMES,
          'labels':LABELS,'model_versions':MODEL_VERSIONS,'experimental':True,'temperature':1,
          'coefficients':[[0]*5,[0]*5,[0]*5],'intercepts':[-10,-10,10],
          'supported_language_pairs':[['en','en']],
          'contradiction_veto':{'en':.9},
          'thresholds':{'en':{label:.9 for label in LABELS}},'release_gates':{'en':{'passed':passed}}}
    path=tmp_path/'calibration.json';path.write_text(json.dumps(data))
    monkeypatch.setenv('RECALLX_CALIBRATION_PATH',str(path))


def evidence():
    return [{'concept_id':'duration','text':'lasting a short time','weight':1,'required':True,'alignment':.9,
             'entailment':.95,'neutrality':.03,'contradiction':.02,'support':.855,
             'evidence_span':'temporary','contradiction_span':None}]


def test_canonical_contract_rejects_client_references(client):
    response=client.post('/grade',json={'word':'ephemeral','stored_definition':'forever','user_answer':'forever'})
    assert response.status_code==422


def test_rubric_operation_replay_is_idempotent_and_conflict_checked(client):
    request={'operation_id':str(uuid.uuid4()),'content_revision':1,
             'concepts':[{'id':'duration','text':'lasting briefly'}]}
    first=client.put('/items/item/rubric',json=request)
    second=client.put('/items/item/rubric',json=request)
    assert first.status_code==second.status_code==200
    assert first.json()==second.json()
    assert len(client.get('/items/item/rubrics').json())==1
    request['concepts'][0]['text']='lasting forever'
    assert client.put('/items/item/rubric',json=request).status_code==409


def test_rubric_approval_receipt_does_not_reactivate_a_retired_revision(client):
    first = client.put('/items/item/rubric', json={'content_revision': 1,
        'concepts': [{'id': 'core', 'text': 'lasting briefly'}]}).json()
    request = {'operation_id': str(uuid.uuid4()), 'content_revision': 1}
    path = f'/items/item/rubrics/{first["revision"]}/approve'
    approved = client.post(path, json=request)
    assert approved.status_code == 200
    newer = client.put('/items/item/rubric', json={'content_revision': 1,
        'concepts': [{'id': 'core', 'text': 'lasting a short time'}]}).json()
    other_path = f'/items/item/rubrics/{newer["revision"]}/approve'
    assert client.post(other_path, json={'content_revision': 1}).status_code == 200
    assert client.post(path, json=request).json() == approved.json()
    assert client.post(other_path, json=request).status_code == 409
    with database.connect() as conn:
        assert conn.execute("SELECT revision FROM rubrics WHERE status='approved'").fetchone()[0] == newer['revision']
        assert conn.execute("SELECT COUNT(*) FROM operations WHERE kind='rubric_approval'").fetchone()[0] == 1


def test_uncalibrated_reference_answer_language_pair_abstains(client,tmp_path,monkeypatch):
    draft=client.put('/items/item/rubric',json={'content_revision':1,'reference_language':'hi',
        'concepts':[{'id':'duration','text':'थोड़े समय तक रहने वाला'}]}).json()
    client.post(f'/items/item/rubrics/{draft["revision"]}/approve',json={'content_revision':1})
    artifact(tmp_path,monkeypatch)
    with database.connect() as conn:
        conn.execute('UPDATE learner_settings SET experimental_grading=1')
    infer=AsyncMock(side_effect=AssertionError('Unvalidated pair must not run inference'))
    monkeypatch.setattr(service.models,'infer',infer)
    response=client.post('/grade',json=payload()).json()
    assert response['decision']=='uncertain' and response['reason']=='unsupported_language_pair'
    infer.assert_not_called()


def test_unapproved_or_uncalibrated_abstains_without_model(client,monkeypatch):
    inference=AsyncMock(side_effect=AssertionError('Model must not run'))
    monkeypatch.setattr(service.models,'infer',inference)
    response=client.post('/grade',json=payload()).json()
    assert response['decision']=='uncertain'
    assert response['reason']=='rubric_not_approved'
    approve(client)
    response=client.post('/grade',json=payload()).json()
    assert response['reason']=='calibration_unavailable'
    inference.assert_not_called()


def test_experimental_requires_explicit_setting_and_passing_slice(client,tmp_path,monkeypatch):
    approve(client);artifact(tmp_path,monkeypatch)
    inference=AsyncMock(return_value={'concept_results':evidence()})
    monkeypatch.setattr(service.models,'infer',inference)
    response=client.post('/grade',json=payload()).json()
    assert response['reason']=='experimental_disabled'
    with database.connect() as conn:
        conn.execute("UPDATE learner_settings SET experimental_grading=1 WHERE learner_id='personal'")
    response=client.post('/grade',json=payload()).json()
    assert response['decision']=='correct'
    assert response['experimental'] is True
    assert response['coverage']==pytest.approx(.855)
    artifact(tmp_path,monkeypatch,passed=False)
    assert client.post('/grade',json=payload()).json()['decision']=='uncertain'
    assert inference.await_count==1


def test_attempt_idempotency_and_conflict(client):
    request=payload()
    first=client.post('/grade',json=request)
    assert first.status_code==200
    assert client.post('/assessments',json=request).json()==first.json()
    assert client.post('/grade',json={**request,'answer':'different'}).status_code==409
    with database.connect() as conn:
        assert conn.execute('SELECT COUNT(*) FROM assessments').fetchone()[0]==1
        assert conn.execute('SELECT COUNT(*) FROM review_events').fetchone()[0]==0


def test_revision_rejection_and_new_draft_does_not_revoke_approved(client):
    approve(client)
    client.put('/items/item/rubric',json={'content_revision':1,'concepts':[{'id':'core','text':'brief'}]})
    response=client.post('/grade',json=payload()).json()
    assert response['rubric_revision']==1
    assert client.post('/grade',json=payload(content_revision=2)).status_code==409


def test_tutor_is_practice_and_speech_failure_preserves_assessment(client,monkeypatch):
    monkeypatch.setattr(tutor,'synthesize',AsyncMock(side_effect=RuntimeError('offline')))
    data=payload(answer='hint')
    response=client.post('/tutor/chat_and_speak',json=data)
    assert response.status_code==200,response.text
    result=response.json()
    assert result['assessment']['mode']=='tutor'
    assert result['assessment']['assisted'] is True
    assert result['evaluation']=='uncertain'
    assert result['audio_error']
    assert client.post('/grade',json=data).status_code==409
    with database.connect() as conn:
        assert conn.execute('SELECT COUNT(*) FROM review_events').fetchone()[0]==0


def test_failure_is_uncertain_and_assessment_persisted(client,tmp_path,monkeypatch):
    approve(client);artifact(tmp_path,monkeypatch)
    with database.connect() as conn:
        conn.execute('UPDATE learner_settings SET experimental_grading=1')
    monkeypatch.setattr(service.models,'infer',AsyncMock(return_value={'error':'model_unavailable'}))
    response=client.post('/grade',json=payload()).json()
    assert response['reason']=='model_unavailable'
    assert response['decision']=='uncertain'
    assert client.get('/assessments/'+response['id']).json()==response


def test_assisted_tutor_practice_receives_evidence_without_scheduling(client,tmp_path,monkeypatch):
    approve(client);artifact(tmp_path,monkeypatch)
    with database.connect() as conn:
        conn.execute('UPDATE learner_settings SET experimental_grading=1')
    infer=AsyncMock(return_value={'concept_results':evidence()})
    monkeypatch.setattr(service.models,'infer',infer)
    response=client.post('/tutor/chat',json=payload(assisted=True)).json()['assessment']
    assert response['decision']=='correct' and response['assisted'] is True
    assert response['mode']=='tutor'
    infer.assert_awaited_once()
    with database.connect() as conn:
        assert conn.execute('SELECT COUNT(*) FROM review_events').fetchone()[0]==0


def test_feature_aggregation_does_not_hide_contradiction():
    results=evidence()
    results.append({**results[0],'concept_id':'other','required':False,'contradiction':.99,'support':.98})
    values=features(results)
    assert values[0]==pytest.approx(.855)
    assert values[2]==.99


def test_strong_contradiction_cannot_be_overridden_by_correct_logit():
    from assessment.scoring import decide_probabilities
    label,confidence,reason=decide_probabilities([.01,.01,.98],[.98,.98,.95,.98,.01],
                                                {label:.9 for label in LABELS},.9)
    assert label=='uncertain' and reason=='contradiction_unresolved'
    label,_,_=decide_probabilities([.98,.01,.01],[.98,.98,.95,.98,.01],
                                   {label:.9 for label in LABELS},.9)
    assert label=='incorrect'


@pytest.mark.parametrize('extra', ['qualifiers', 'misconceptions'])
def test_conflict_evidence_points_to_the_clause_that_triggered_it(monkeypatch, extra):
    """A supporting first clause must not be cited for a conflicting later qualifier."""
    from contextlib import nullcontext
    import sys
    from types import SimpleNamespace
    from assessment.inference import DiscriminativeModels

    class Similarities:
        def __getitem__(self, indices):
            return .8 if indices[0] == 0 else .2

    class SpanEmbeddings:
        def __matmul__(self, references):
            return Similarities()

    monkeypatch.setitem(sys.modules, 'numpy', SimpleNamespace(
        argmax=lambda values: max(range(len(values)), key=values.__getitem__)))
    model = DiscriminativeModels.__new__(DiscriminativeModels)
    model.torch = SimpleNamespace(inference_mode=nullcontext)
    model.embedding = SimpleNamespace(encode=lambda *args, **kwargs: SpanEmbeddings())
    model.spans = lambda answer: ['supporting clause', 'conflicting clause']
    model.reference_embeddings = lambda *args: SimpleNamespace(T=None)
    base = [{'entailment': .7, 'neutral': .2, 'contradiction': .1},
            {'entailment': .1, 'neutral': .85, 'contradiction': .05}]
    other = [{'entailment': .4, 'neutral': .5, 'contradiction': .1},
             {'entailment': .05, 'neutral': .05, 'contradiction': .9}]
    if extra == 'misconceptions':
        other[1] = {'entailment': .9, 'neutral': .05, 'contradiction': .05}
    responses = iter([base, other])
    model.classify_pairs = lambda *args: next(responses)
    result = model.assess('two clauses', 'word', [{'id': 'core', 'text': 'reference',
        extra: ['qualified reference']}], 'rubric')[0]
    assert result['evidence_span'] == 'supporting clause'
    assert result['contradiction'] == .9
    assert result['contradiction_span'] == 'conflicting clause'


@pytest.mark.parametrize('broken',[float('nan'),-0.1,1.1,None])
def test_invalid_calibration_policy_abstains_without_loading_models(client,tmp_path,monkeypatch,broken):
    approve(client);artifact(tmp_path,monkeypatch)
    path=tmp_path/'calibration.json'
    saved=json.loads(path.read_text())
    saved['thresholds']['en']['correct']=broken
    path.write_text(json.dumps(saved))
    with database.connect() as conn:
        conn.execute('UPDATE learner_settings SET experimental_grading=1')
    infer=AsyncMock(side_effect=AssertionError('Invalid artifact must not run inference'))
    monkeypatch.setattr(service.models,'infer',infer)
    response=client.post('/grade',json=payload()).json()
    assert response['decision']=='uncertain' and response['reason']=='calibration_unavailable'
    infer.assert_not_called()


def test_raw_response_removal_preserves_assessment_facts(client):
    response=client.post('/grade',json=payload()).json()
    removed=client.delete('/assessments/'+response['id']+'/answer')
    assert removed.status_code==200
    with database.connect() as conn:
        row=conn.execute('SELECT * FROM assessments WHERE id=?',(response['id'],)).fetchone()
        assert row['answer_text'] is None
        assert row['decision']=='uncertain'
        assert row['request_hash']


def test_expired_response_is_redacted_on_read(client):
    response=client.post('/grade',json=payload()).json()
    with database.connect() as conn:
        conn.execute('UPDATE assessments SET raw_expires_at=1 WHERE id=?',(response['id'],))
    assert client.get('/assessments/'+response['id']).status_code==200
    with database.connect() as conn:
        assert conn.execute('SELECT answer_text FROM assessments WHERE id=?',(response['id'],)).fetchone()[0] is None


@pytest.mark.asyncio
async def test_generative_authority_removed():
    from providers.chain import ProviderChain
    chain=ProviderChain.__new__(ProviderChain)
    with pytest.raises(RuntimeError,match='Generative grading is disabled'):
        await chain.grade('ephemeral','temporary','temporary')
    with pytest.raises(RuntimeError,match='Generative tutor assessment is disabled'):
        await chain.tutor_chat()


@pytest.mark.asyncio
async def test_cancelled_request_discards_worker_response(monkeypatch):
    import asyncio
    model=service.ModelService()
    started=asyncio.Event()
    async def blocked(payload):
        started.set()
        await asyncio.sleep(30)
    monkeypatch.setattr(model,'_infer',blocked)
    close=AsyncMock()
    monkeypatch.setattr(model,'close',close)
    task=asyncio.create_task(model.infer(answer='one'))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError): await task
    close.assert_awaited_once()
    assert not model._lock.locked()
