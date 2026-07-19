import json
import time
import uuid

from fastapi import HTTPException

from assessment.contracts import Concept, RubricInput


def record(row):
    data = dict(row)
    data['concepts'] = json.loads(data.pop('concepts_json'))
    return data


def canonical_item(conn, item_id, content_revision=None):
    row = conn.execute('SELECT * FROM words WHERE id=? AND deleted_at IS NULL', (item_id,)).fetchone()
    if row is None:
        raise HTTPException(404, 'Learning item not found')
    revision = dict(row).get('content_revision', 1)
    if content_revision is not None and revision != content_revision:
        raise HTTPException(409, {'error': 'content_revision_mismatch', 'content_revision': revision})
    return dict(row)


def create_draft(conn, item_id, definition, reference_language='en', concepts=None, content_revision=1, operation_id=None):
    """Create a new immutable draft revision in the caller's transaction."""
    if reference_language == 'auto':
        reference_language = 'en'
    payload = RubricInput(content_revision=content_revision, reference_language=reference_language,
                          concepts=concepts or [Concept(id='core', text=definition)])
    normalized=[c.model_dump() for c in payload.concepts]
    ident = str(operation_id or uuid.uuid4())
    if operation_id:
        existing=conn.execute('SELECT * FROM rubrics WHERE id=?',(ident,)).fetchone()
        if existing:
            if (existing['item_id']!=item_id or existing['content_revision']!=content_revision
                or existing['reference_language']!=reference_language or json.loads(existing['concepts_json'])!=normalized):
                raise HTTPException(409,'Rubric operation ID already used with different content')
            return record(existing)
    revision = conn.execute('SELECT COALESCE(MAX(revision),0)+1 FROM rubrics WHERE item_id=?', (item_id,)).fetchone()[0]
    conn.execute('''INSERT INTO rubrics(id,item_id,revision,content_revision,status,reference_language,concepts_json,created_at)
                    VALUES (?,?,?,?,?,?,?,?)''',
                 (ident,item_id,revision,content_revision,'draft',reference_language,
                  json.dumps(normalized, ensure_ascii=False), int(time.time()*1000)))
    return record(conn.execute('SELECT * FROM rubrics WHERE id=?', (ident,)).fetchone())
