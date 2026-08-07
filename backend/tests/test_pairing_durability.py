import json
import uuid

import pytest
from fastapi.testclient import TestClient

import auth
import database
from main import app


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setenv('RECALLX_DB_PATH',str(tmp_path/'pairing.sqlite'))
    monkeypatch.setenv('RECALLX_DATA_DIR',str(tmp_path/'data'))
    monkeypatch.setenv('RECALLX_BOOTSTRAP_SECRET','durability-test-secret')
    monkeypatch.setenv('RECALLX_DISABLE_DISPATCH','1')
    with TestClient(app) as client:
        yield client


def pair_first(api):
    response=api.post('/pairing/bootstrap',json={'bootstrap_secret':'durability-test-secret','device_name':'Phone','operation_id':str(uuid.uuid4())})
    assert response.status_code==200,response.text
    result=response.json()
    api.headers['Authorization']='Bearer '+result['token']
    return result


def test_bootstrap_lost_ack_returns_same_device_without_logging_credentials(api):
    request={'bootstrap_secret':'durability-test-secret','device_name':'Phone','operation_id':str(uuid.uuid4())}
    first=api.post('/pairing/bootstrap',json=request)
    assert first.status_code==200
    assert api.post('/pairing/bootstrap',json=request).json()==first.json()
    assert api.post('/pairing/bootstrap',json={**request,'device_name':'Different'}).status_code==409
    assert api.post('/pairing/bootstrap',json={**request,'bootstrap_secret':'wrong'}).status_code==403
    token=first.json()['token']
    with database.connect() as conn:
        assert conn.execute('SELECT COUNT(*) FROM devices').fetchone()[0]==1
        receipt=conn.execute('SELECT * FROM operations WHERE id=?',(request['operation_id'],)).fetchone()
        serialized=json.dumps(dict(receipt))
        assert request['bootstrap_secret'] not in serialized and token not in serialized
    assert api.get('/sync/snapshot',headers={'Authorization':'Bearer '+token}).status_code==200


def test_bootstrap_replay_cannot_restore_revoked_device(api):
    request={'bootstrap_secret':'durability-test-secret','device_name':'Phone','operation_id':str(uuid.uuid4())}
    identity=api.post('/pairing/bootstrap',json=request).json()
    api.headers['Authorization']='Bearer '+identity['token']
    assert api.delete('/pairing/devices/'+identity['device_id']).status_code==200
    assert api.post('/pairing/bootstrap',json=request).status_code==410
    with database.connect() as conn:
        assert conn.execute('SELECT COUNT(*) FROM devices').fetchone()[0]==1


def test_start_and_approval_retries_preserve_poll_credentials_and_original_receipt(api):
    pair_first(api)
    request={'device_name':'TV','operation_id':str(uuid.uuid4())}
    first=api.post('/pairing/start',json=request)
    assert first.status_code==200
    pair=first.json()
    assert api.post('/pairing/start',json=request).json()==pair
    assert api.post('/pairing/start',json={**request,'device_name':'Other'}).status_code==409
    approval={'code':pair['code'],'operation_id':str(uuid.uuid4())}
    approved=api.post('/pairing/approve',json=approval)
    assert approved.status_code==200
    delivered=api.get('/pairing/'+pair['id'],params={'poll_token':pair['poll_token']})
    assert delivered.status_code==200
    assert api.get('/pairing/'+pair['id'],params={'poll_token':pair['poll_token']}).json()==delivered.json()
    with database.connect() as conn:
        assert conn.execute('SELECT COUNT(*) FROM devices').fetchone()[0]==2
        receipt=dict(conn.execute('SELECT * FROM operations WHERE id=?',(request['operation_id'],)).fetchone())
        assert pair['poll_token'] not in json.dumps(receipt)
        assert delivered.json()['token'] not in json.dumps(receipt)
        conn.execute('UPDATE pairing_requests SET expires_at=? WHERE id=?',('2000-01-01T00:00:00+00:00',pair['id']))
    # The approved operation remains acknowledged even after code expiration.
    assert api.post('/pairing/approve',json=approval).json()==approved.json()
    assert api.post('/pairing/start',json=request).status_code==410
    assert api.post('/pairing/approve',json={**approval,'code':'999999' if pair['code']!='999999' else '000000'}).status_code==409


def test_revoke_uuid_receipt_keeps_first_revocation_time_and_detects_collision(api):
    pair_first(api)
    target=api.post('/pairing/bootstrap',json={'bootstrap_secret':'durability-test-secret','device_name':'Second'}).json()['device_id']
    headers={'X-Operation-ID':str(uuid.uuid4())}
    first=api.delete('/pairing/devices/'+target,headers=headers)
    assert first.status_code==200
    with database.connect() as conn:
        timestamp=conn.execute('SELECT revoked_at FROM devices WHERE id=?',(target,)).fetchone()[0]
    assert api.delete('/pairing/devices/'+target,headers=headers).json()==first.json()
    assert api.delete('/pairing/devices/different',headers=headers).status_code==409
    with database.connect() as conn:
        assert conn.execute('SELECT revoked_at FROM devices WHERE id=?',(target,)).fetchone()[0]==timestamp


@pytest.mark.parametrize('route,payload,table',[
    ('bootstrap',{'bootstrap_secret':'durability-test-secret','device_name':'Phone'},'devices'),
    ('start',{'device_name':'TV'},'pairing_requests'),
])
def test_pairing_state_and_receipt_roll_back_together(api,monkeypatch,route,payload,table):
    def failed(*_):raise RuntimeError('Interrupted receipt write')
    monkeypatch.setattr(auth,'_remember',failed)
    with pytest.raises(RuntimeError,match='Interrupted receipt write'):
        api.post('/pairing/'+route,json={**payload,'operation_id':str(uuid.uuid4())})
    with database.connect() as conn:
        assert conn.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]==0
