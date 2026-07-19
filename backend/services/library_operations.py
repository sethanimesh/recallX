"""Transactional receipts for retried library mutations."""
import hashlib
import json
from uuid import UUID

from fastapi import HTTPException, Request
from pydantic import BaseModel

import database


class LibraryOperation:
    def __init__(self, request: Request, operation_id: UUID | None, payload=None):
        self.id = str(operation_id) if operation_id else None
        self.learner_id = request.state.learner_id
        envelope = {'method': request.method, 'path': request.url.path, 'payload': payload}
        canonical = json.dumps(envelope, sort_keys=True, separators=(',', ':'))
        self.payload_json = json.dumps({**envelope, 'sha256': hashlib.sha256(canonical.encode()).hexdigest()}, sort_keys=True, separators=(',', ':'))

    def lookup(self, conn):
        if self.id is None:
            return False, None
        old = conn.execute('SELECT * FROM operations WHERE id=?', (self.id,)).fetchone()
        if old is None:
            return False, None
        if old['learner_id'] != self.learner_id or old['kind'] != 'library_mutation' or old['payload_json'] != self.payload_json:
            raise HTTPException(409, 'Operation ID already used with different content')
        return True, json.loads(old['response_json'])

    def remember(self, conn, result):
        if isinstance(result, BaseModel):
            result = result.model_dump(mode='json')
        if self.id is not None:
            conn.execute('INSERT INTO operations VALUES(?,?,?,?,?,?)', (self.id, self.learner_id, 'library_mutation', database.utcnow(), self.payload_json, json.dumps(result)))
        return result
