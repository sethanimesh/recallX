"""FSRS is the only authority for memory transitions; every input is versioned."""
from datetime import datetime, timezone
import hashlib
import json
from fsrs import Scheduler, Card, Rating
import database

ALGORITHM='fsrs-6/py-fsrs-6.3.2'


def moment(value):
    if isinstance(value,datetime): result=value
    else: result=datetime.fromisoformat(value.replace('Z','+00:00'))
    if result.tzinfo is None: raise ValueError('Timestamp must include UTC offset')
    return result.astimezone(timezone.utc)


def settings(conn, learner='personal'):
    return dict(conn.execute('SELECT * FROM learner_settings WHERE learner_id=?',(learner,)).fetchone())


def ensure_defaults(conn, learner='personal'):
    for mode in ('recall','flashcard'):
        id=f'default:{learner}:{mode}:6.3.2'
        conn.execute('INSERT OR IGNORE INTO parameter_versions(id,learner_id,mode,parameters_json,algorithm_version,status,created_at,activated_at) VALUES(?,?,?,?,?,?,?,?)',(id,learner,mode,json.dumps(list(Scheduler().parameters)),ALGORITHM,'active',database.utcnow(),database.utcnow()))


def active_parameters(conn, learner, mode):
    ensure_defaults(conn,learner)
    return conn.execute("SELECT * FROM parameter_versions WHERE learner_id=? AND mode=? AND status='active' ORDER BY activated_at DESC,id DESC LIMIT 1",(learner,mode)).fetchone()


def scheduler(conn, parameter_version, retention=.9):
    row=conn.execute('SELECT parameters_json FROM parameter_versions WHERE id=?',(parameter_version,)).fetchone()
    if not row: raise ValueError('Unknown parameter version')
    return Scheduler(parameters=json.loads(row[0]),desired_retention=retention,enable_fuzzing=False)


def ensure_cards(conn, item_id, learner_id='personal'):
    config=settings(conn,learner_id)
    for mode in ('recall','flashcard'):
        p=active_parameters(conn,learner_id,mode)
        card_id=int.from_bytes(hashlib.sha256(f'{learner_id}:{item_id}:{mode}'.encode()).digest()[:7],'big')
        card=Card(card_id=card_id,due=datetime.now(timezone.utc))
        conn.execute('INSERT OR IGNORE INTO memory_states VALUES(?,?,?,?,?,?,?,?,?)',(learner_id,item_id,mode,card_id,card.to_json(),0,config['progress_generation'],p['id'],database.utcnow()))


def state_dict(row):
    if not row: return None
    result=dict(row); result['card']=json.loads(result.pop('card_json')); result['due']=result['card']['due']
    return result


def replay(conn, learner, item_id, mode, *, candidate_version=None, preserve_due=False):
    ensure_cards(conn,item_id,learner)
    old=conn.execute('SELECT * FROM memory_states WHERE learner_id=? AND item_id=? AND mode=?',(learner,item_id,mode)).fetchone()
    config=settings(conn,learner)
    rows=conn.execute("SELECT * FROM review_events WHERE learner_id=? AND item_id=? AND mode=? AND progress_generation=? AND status='acknowledged' ORDER BY answered_at,device_id,device_sequence,id",(learner,item_id,mode,config['progress_generation'])).fetchall()
    card=Card(card_id=old['card_id'],due=moment(rows[0]['answered_at']) if rows else datetime.now(timezone.utc))
    active=active_parameters(conn,learner,mode)
    activation=conn.execute('SELECT new_id,created_at FROM parameter_activations WHERE learner_id=? AND mode=? ORDER BY created_at DESC,id DESC LIMIT 1',(learner,mode)).fetchone()
    last_version=candidate_version or active['id']
    for row in rows:
        correction=conn.execute('SELECT rating FROM review_corrections WHERE event_id=? ORDER BY created_at DESC,id DESC LIMIT 1',(row['id'],)).fetchone()
        rating=correction[0] if correction else row['rating']
        if rating is None: continue
        # Activation deliberately rebuilds preceding history under the fitted
        # weights, matching prospective evaluation. It must not overwrite the
        # recorded configuration of any review after that activation boundary.
        if candidate_version:
            last_version=candidate_version
        elif activation and moment(row['answered_at'])<=moment(activation['created_at']):
            last_version=activation['new_id']
        else:
            last_version=row['parameter_version']
        engine=scheduler(conn,last_version,row['desired_retention'])
        card,_=engine.review_card(card,Rating(rating),review_datetime=moment(row['answered_at']))
    if preserve_due: card.due=Card.from_json(old['card_json']).due
    conn.execute('UPDATE memory_states SET card_json=?,state_version=state_version+1,progress_generation=?,parameter_version=?,updated_at=? WHERE learner_id=? AND item_id=? AND mode=?',(card.to_json(),config['progress_generation'],last_version,database.utcnow(),learner,item_id,mode))
    return state_dict(conn.execute('SELECT * FROM memory_states WHERE learner_id=? AND item_id=? AND mode=?',(learner,item_id,mode)).fetchone())
