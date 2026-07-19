"""Keep legacy feature tests isolated while exercising real device authentication."""
from pathlib import Path
import hashlib
import pytest
import database

LEGACY_API_MODULES={'test_extract.py','test_providers.py','test_extract_endpoint.py','test_words_router.py','test_tags_router.py','test_stats_router.py'}


@pytest.fixture(autouse=True)
def isolate_legacy_api(request,tmp_path,monkeypatch):
    if Path(str(request.node.fspath)).name not in LEGACY_API_MODULES:
        yield
        return
    monkeypatch.setattr(database,'_DEFAULT_DB_PATH',str(tmp_path/'isolated-api.sqlite'))
    monkeypatch.setenv('RECALLX_DISABLE_DISPATCH','1')
    from fastapi.testclient import TestClient
    original=TestClient.request
    def authenticated(self,*args,**kwargs):
        database.init_db()
        with database.connect() as conn:
            conn.execute('INSERT OR IGNORE INTO devices VALUES(?,?,?,?,?,NULL)',('legacy-test-device','personal','Test device',hashlib.sha256(b'legacy-test-token').hexdigest(),database.utcnow()))
        headers=dict(kwargs.pop('headers',{}) or {})
        headers.setdefault('Authorization','Bearer legacy-test-token')
        return original(self,*args,headers=headers,**kwargs)
    monkeypatch.setattr(TestClient,'request',authenticated)
    yield
