"""Meaning-specific learning items with stable identities and archived revisions."""
import json
import string
import time
from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel
import database
from routers.extract import get_chain
from services.scheduling import ensure_cards
from services.library_operations import LibraryOperation

router=APIRouter(tags=['items'])


class TagInfo(BaseModel):
    id:str
    name:str


class WordRecord(BaseModel):
    id:str
    word:str
    definition:str
    example_sentence:str
    mnemonic:Optional[str]=None
    source_type:Optional[str]=None
    created_at:int
    updated_at:int
    deleted_at:Optional[int]=None
    sense_id:str
    content_revision:int=1
    etymology:Optional[str]=None
    tags:list[TagInfo]=[]


class CreateWordRequest(BaseModel):
    id:str
    word:str
    definition:str
    example_sentence:str
    mnemonic:Optional[str]=None
    source_type:Optional[str]=None
    created_at:int
    updated_at:int
    sense_id:Optional[str]=None
    etymology:Optional[str]=None


class UpdateWordRequest(BaseModel):
    word:Optional[str]=None
    definition:Optional[str]=None
    example_sentence:Optional[str]=None
    mnemonic:Optional[str]=None
    etymology:Optional[str]=None
    expected_content_revision:Optional[int]=None


def _normalize_stored_word(word): return string.capwords(word.strip())


def record(conn,id):
    row=conn.execute('SELECT * FROM words WHERE id=?',(id,)).fetchone()
    if not row: raise HTTPException(404,'Word not found')
    result=dict(row)
    result['tags']=[dict(r) for r in conn.execute('SELECT t.id,t.name FROM tags t JOIN word_tags wt ON wt.tag_id=t.id WHERE wt.word_id=?',(id,))]
    return result


def revision(conn,id):
    item=record(conn,id)
    conn.execute('INSERT INTO item_revisions VALUES(?,?,?,?)',(id,item['content_revision'],json.dumps(item),database.utcnow()))


@router.post('/words',response_model=WordRecord,status_code=201)
def create_word(req:CreateWordRequest,request:Request,operation_id:UUID|None=Header(default=None,alias='X-Operation-ID')):
    operation=LibraryOperation(request,operation_id,req.model_dump(mode='json',exclude_unset=True))
    word=_normalize_stored_word(req.word)
    if not word or not req.definition.strip(): raise HTTPException(422,'Word and definition cannot be blank')
    with database.connect(immediate=True) as conn:
        found,result=operation.lookup(conn)
        if found:return result
        existing=conn.execute('SELECT * FROM words WHERE id=?',(req.id,)).fetchone()
        if existing:
            if existing['word']==word and existing['definition']==req.definition and existing['example_sentence']==req.example_sentence and existing['deleted_at'] is None: return operation.remember(conn,record(conn,req.id))
            raise HTTPException(409,'Item ID already exists with different content')
        same=conn.execute('SELECT id FROM words WHERE word=? COLLATE NOCASE AND definition=? AND deleted_at IS NULL',(word,req.definition)).fetchone()
        if same: raise HTTPException(409,{'message':'Meaning already exists','word_id':same[0]})
        conn.execute('INSERT INTO words(id,word,definition,example_sentence,mnemonic,source_type,created_at,updated_at,sense_id,etymology) VALUES(?,?,?,?,?,?,?,?,?,?)',(req.id,word,req.definition,req.example_sentence,req.mnemonic,req.source_type,req.created_at,req.updated_at,req.sense_id or req.id,req.etymology))
        revision(conn,req.id);ensure_cards(conn,req.id)
        # Optional feature import is intentionally local to keep migration bootstrap independent.
        from assessment.rubrics import create_draft
        create_draft(conn,req.id,req.definition)
        return operation.remember(conn,record(conn,req.id))


@router.get('/words',response_model=list[WordRecord])
def get_words():
    with database.connect() as conn:
        return [record(conn,r[0]) for r in conn.execute('SELECT id FROM words WHERE deleted_at IS NULL ORDER BY word')]


@router.patch('/words/{word_id}',response_model=WordRecord)
def update_word(word_id:str,req:UpdateWordRequest,request:Request,operation_id:UUID|None=Header(default=None,alias='X-Operation-ID')):
    operation=LibraryOperation(request,operation_id,req.model_dump(mode='json',exclude_unset=True))
    with database.connect(immediate=True) as conn:
        found,result=operation.lookup(conn)
        if found:return result
        old=record(conn,word_id)
        if old['deleted_at'] is not None: raise HTTPException(404,'Item deleted')
        expected=req.expected_content_revision or 1
        updates=req.model_dump(exclude_unset=True,exclude={'expected_content_revision'})
        if not updates: return operation.remember(conn,old)
        if updates.get('word') is not None: updates['word']=_normalize_stored_word(updates['word'])
        if any(updates.get(k)=='' or (k in updates and updates[k] is None) for k in ('word','definition','example_sentence')): raise HTTPException(422,'Content fields cannot be empty')
        if expected!=old['content_revision']:
            if all(old.get(k)==v for k,v in updates.items()): return operation.remember(conn,old)
            raise HTTPException(409,'Item changed; refresh before editing')
        same=conn.execute('SELECT id FROM words WHERE word=? COLLATE NOCASE AND definition=? AND id<>? AND deleted_at IS NULL',(updates.get('word',old['word']),updates.get('definition',old['definition']),word_id)).fetchone()
        if same: raise HTTPException(409,{'message':'Meaning already exists','word_id':same[0]})
        semantic=any(k in updates and updates[k]!=old[k] for k in ('word','definition','example_sentence'))
        updates['updated_at']=int(time.time()*1000)
        if semantic: updates['content_revision']=old['content_revision']+1
        conn.execute('UPDATE words SET '+','.join(k+'=?' for k in updates)+' WHERE id=?',(*updates.values(),word_id))
        if semantic:
            revision(conn,word_id)
            from assessment.rubrics import create_draft
            create_draft(conn,word_id,updates.get('definition',old['definition']),content_revision=updates['content_revision'])
        return operation.remember(conn,record(conn,word_id))


@router.delete('/words/{word_id}',response_model=WordRecord)
def delete_word(word_id:str,request:Request,operation_id:UUID|None=Header(default=None,alias='X-Operation-ID'),expected_content_revision:int|None=Query(default=None,ge=1)):
    operation=LibraryOperation(request,operation_id,{'expected_content_revision':expected_content_revision})
    with database.connect(immediate=True) as conn:
        found,result=operation.lookup(conn)
        if found:return result
        old=record(conn,word_id)
        if expected_content_revision is not None and expected_content_revision!=old['content_revision']:
            raise HTTPException(409,'Item changed; refresh before deleting')
        if old['deleted_at'] is None:
            now=int(time.time()*1000)
            conn.execute('UPDATE words SET deleted_at=?,updated_at=? WHERE id=?',(now,now,word_id))
        return operation.remember(conn,record(conn,word_id))


@router.post('/words/{word_id}/generate-mnemonic',response_model=WordRecord)
async def generate_word_mnemonic(word_id:str,request:Request,operation_id:UUID|None=Header(default=None,alias='X-Operation-ID')):
    operation=LibraryOperation(request,operation_id)
    with database.connect(immediate=True) as conn:
        found,result=operation.lookup(conn)
        if found:return result
        old=record(conn,word_id)
        if old['deleted_at'] is not None:raise HTTPException(404,'Item deleted')
        if old['mnemonic']: return operation.remember(conn,old)
    mnemonic=await get_chain().generate_mnemonic(old['word'],old['definition'])
    if not mnemonic: raise HTTPException(503,'Mnemonic generation unavailable')
    # Late enrichment cannot overwrite manual edits.
    with database.connect(immediate=True) as conn:
        found,result=operation.lookup(conn)
        if found:return result
        current=record(conn,word_id)
        if current['deleted_at'] is None and not current['mnemonic'] and current['content_revision']==old['content_revision']:
            conn.execute('UPDATE words SET mnemonic=?,updated_at=? WHERE id=?',(mnemonic,int(time.time()*1000),word_id))
        return operation.remember(conn,record(conn,word_id))
