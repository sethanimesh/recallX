"""Single-learner, revocable device sessions. Model workers never expose this API."""
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import uuid
from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
import database

router = APIRouter(prefix='/pairing', tags=['pairing'])


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def bootstrap_secret() -> str:
    configured = os.environ.get('RECALLX_BOOTSTRAP_SECRET')
    if configured:
        return configured
    secret_file = Path(os.environ.get('RECALLX_DATA_DIR', str(Path(__file__).parent/'data'))) / 'bootstrap.secret'
    secret_file.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd=os.open(secret_file,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    except FileExistsError:
        return secret_file.read_text().strip()
    value=secrets.token_urlsafe(32)
    with os.fdopen(fd,'w') as stream: stream.write(value)
    return value


def _pair_token(pair) -> str:
    return hmac.new(bootstrap_secret().encode(),(pair['id']+':'+pair['poll_hash']).encode(),hashlib.sha256).hexdigest()


def _operation_token(purpose, identity, operation_id):
    return hmac.new(bootstrap_secret().encode(),f'{purpose}:{identity}:{operation_id}'.encode(),hashlib.sha256).hexdigest()


def _receipt(conn, operation_id, kind, payload, learner='personal'):
    if operation_id is None:return None
    row=conn.execute('SELECT * FROM operations WHERE id=?',(str(operation_id),)).fetchone()
    if not row:return None
    if row['kind']!=kind or row['learner_id']!=learner or row['payload_json']!=json.dumps(payload,sort_keys=True):
        raise HTTPException(409,'Operation ID already used with different content')
    return json.loads(row['response_json'])


def _remember(conn, operation_id, kind, payload, response, learner='personal'):
    if operation_id is not None:
        conn.execute('INSERT INTO operations VALUES(?,?,?,?,?,?)',(str(operation_id),learner,kind,database.utcnow(),json.dumps(payload,sort_keys=True),json.dumps(response)))
    return response


async def authenticate(request: Request, call_next):
    public = request.url.path in ('/health','/docs','/redoc','/openapi.json','/pairing/start','/pairing/bootstrap') or (request.method=='GET' and request.url.path.startswith('/pairing/') and request.url.path not in ('/pairing/devices',))
    if request.method=='OPTIONS' or public:
        return await call_next(request)
    token=request.headers.get('authorization','')
    if not token.startswith('Bearer '):
        return JSONResponse({'detail':'Pair this device with your RecallX backend.'},status_code=401)
    with database.connect() as conn:
        device=conn.execute('SELECT * FROM devices WHERE token_hash=? AND revoked_at IS NULL',(digest(token[7:]),)).fetchone()
    if not device:
        return JSONResponse({'detail':'Device session expired or revoked. Pair again.'},status_code=401)
    request.state.learner_id=device['learner_id'];request.state.device_id=device['id']
    return await call_next(request)


class Bootstrap(BaseModel):
    bootstrap_secret: str
    device_name: str = Field(min_length=1,max_length=100)
    operation_id: uuid.UUID | None = None


class Start(BaseModel):
    device_name: str = Field(min_length=1,max_length=100)
    operation_id: uuid.UUID | None = None


class Approve(BaseModel):
    code: str = Field(min_length=6,max_length=6)
    operation_id: uuid.UUID | None = None


@router.post('/bootstrap')
def bootstrap(req: Bootstrap):
    if not hmac.compare_digest(req.bootstrap_secret,bootstrap_secret()):
        raise HTTPException(403,'Incorrect bootstrap secret')
    # Authenticate every replay, but never copy the administrator secret into
    # the immutable operation log. Credential delivery is derived, not stored.
    payload={'device_name':req.device_name}
    with database.connect(immediate=True) as conn:
        prior=_receipt(conn,req.operation_id,'pairing_bootstrap',payload)
        if prior:
            device=conn.execute('SELECT * FROM devices WHERE id=? AND revoked_at IS NULL',(prior['device_id'],)).fetchone()
            token=_operation_token('bootstrap-device',prior['device_id'],req.operation_id)
            if not device or not hmac.compare_digest(device['token_hash'],digest(token)):
                raise HTTPException(410,'Pairing session revoked or credentials rotated; start a new attempt')
            return {**prior,'token':token}
        device_id=str(uuid.uuid4())
        token=_operation_token('bootstrap-device',device_id,req.operation_id) if req.operation_id else secrets.token_urlsafe(32)
        conn.execute('INSERT INTO devices VALUES(?,?,?,?,?,NULL)',(device_id,'personal',req.device_name,digest(token),database.utcnow()))
        result={'device_id':device_id,'learner_id':'personal'}
        _remember(conn,req.operation_id,'pairing_bootstrap',payload,result)
        return {**result,'token':token}


@router.post('/start')
def start(req: Start):
    payload={'device_name':req.device_name}
    with database.connect(immediate=True) as conn:
        prior=_receipt(conn,req.operation_id,'pairing_start',payload)
        if prior:
            pair=conn.execute('SELECT * FROM pairing_requests WHERE id=? AND expires_at>?',(prior['id'],database.utcnow())).fetchone()
            poll_token=_operation_token('pairing-poll',prior['id'],req.operation_id)
            if not pair or not hmac.compare_digest(pair['poll_hash'],digest(poll_token)):
                raise HTTPException(410,'Pairing request expired or credentials rotated; start a new attempt')
            return {**prior,'poll_token':poll_token}
        id=str(uuid.uuid4())
        poll_token=_operation_token('pairing-poll',id,req.operation_id) if req.operation_id else secrets.token_urlsafe(32)
        expires=(datetime.now(timezone.utc)+timedelta(minutes=10)).isoformat()
        conn.execute('DELETE FROM pairing_requests WHERE expires_at<?',(database.utcnow(),))
        if conn.execute('SELECT COUNT(*) FROM pairing_requests').fetchone()[0]>=100:
            raise HTTPException(429,'Too many pending pairing requests')
        for _ in range(20):
            code=f'{secrets.randbelow(1000000):06d}'
            if not conn.execute('SELECT 1 FROM pairing_requests WHERE code=?',(code,)).fetchone(): break
        conn.execute('INSERT INTO pairing_requests(id,code,device_name,poll_hash,expires_at) VALUES(?,?,?,?,?)',(id,code,req.device_name,digest(poll_token),expires))
        result={'id':id,'code':code,'expires_at':expires}
        _remember(conn,req.operation_id,'pairing_start',payload,result)
        return {**result,'poll_token':poll_token}


@router.post('/approve')
def approve(req: Approve, request: Request):
    learner=request.state.learner_id;payload={'code':req.code}
    with database.connect(immediate=True) as conn:
        prior=_receipt(conn,req.operation_id,'pairing_approve',payload,learner)
        if prior:return prior
        pair=conn.execute('SELECT * FROM pairing_requests WHERE code=? AND expires_at>?',(req.code,database.utcnow())).fetchone()
        if not pair: raise HTTPException(404,'Pairing code expired or unknown')
        if pair['approved_device_id']:
            return _remember(conn,req.operation_id,'pairing_approve',payload,{'device_id':pair['approved_device_id'],'status':'approved'},learner)
        device_id=str(uuid.uuid4())
        conn.execute('INSERT INTO devices VALUES(?,?,?,?,?,NULL)',(device_id,request.state.learner_id,pair['device_name'],digest(_pair_token(pair)),database.utcnow()))
        conn.execute('UPDATE pairing_requests SET approved_device_id=? WHERE id=?',(device_id,pair['id']))
        return _remember(conn,req.operation_id,'pairing_approve',payload,{'device_id':device_id,'status':'approved'},learner)


@router.get('/devices')
def devices(request: Request):
    with database.connect() as conn:
        return [dict(r) for r in conn.execute('SELECT id,name,created_at,revoked_at FROM devices WHERE learner_id=?',(request.state.learner_id,))]


@router.delete('/devices/{device_id}')
def revoke(device_id: str, request: Request, operation_id: uuid.UUID | None = Header(default=None,alias='X-Operation-ID')):
    learner=request.state.learner_id;payload={'device_id':device_id}
    with database.connect(immediate=True) as conn:
        prior=_receipt(conn,operation_id,'pairing_revoke',payload,learner)
        if prior:return prior
        changed=conn.execute('UPDATE devices SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND learner_id=?',(database.utcnow(),device_id,learner)).rowcount
        if not changed: raise HTTPException(404,'Device not found')
        return _remember(conn,operation_id,'pairing_revoke',payload,{'status':'revoked'},learner)


@router.get('/{id}')
def poll(id: str, poll_token: str):
    with database.connect() as conn:
        pair=conn.execute('SELECT * FROM pairing_requests WHERE id=? AND expires_at>?',(id,database.utcnow())).fetchone()
        if not pair or not hmac.compare_digest(pair['poll_hash'],digest(poll_token)):
            raise HTTPException(404,'Pairing request expired or unknown')
        if not pair['approved_device_id']: return {'status':'pending'}
        device=conn.execute('SELECT * FROM devices WHERE id=? AND revoked_at IS NULL',(pair['approved_device_id'],)).fetchone()
        if not device: raise HTTPException(410,'Device revoked')
        return {'status':'approved','token':_pair_token(pair),'device_id':device['id'],'learner_id':device['learner_id']}
