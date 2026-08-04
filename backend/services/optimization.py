"""Honest eligibility, chronological prediction and conservative fit activation."""
from collections import defaultdict
from datetime import timedelta
import hashlib
import json
import math
import random
from statistics import mean
from fsrs import Card, Scheduler, Rating, ReviewLog
from services.scheduling import moment, ALGORITHM


def clean_history(conn,learner,mode):
    rows=[dict(r) for r in conn.execute('SELECT * FROM review_events WHERE learner_id=? AND mode=? ORDER BY answered_at,device_id,device_sequence,id',(learner,mode))]
    contaminated={(r['item_id'],r['progress_generation']) for r in rows if r['experimental'] or r['assisted'] or r['reason'] in ('assisted_recall','device_time_order_conflict','clock_review_required')}
    contaminated.update((r[0],r[1]) for r in conn.execute('SELECT e.item_id,e.progress_generation FROM review_corrections c JOIN review_events e ON e.id=c.event_id WHERE e.learner_id=? AND e.mode=?',(learner,mode)))
    result=[]
    for r in rows:
        if r['status']!='acknowledged' or (r['item_id'],r['progress_generation']) in contaminated: continue
        # A changed reference meaning starts a distinct fitting sequence.
        key=f"{learner}:{r['item_id']}:{mode}:{r['progress_generation']}:{r['content_revision']}"
        result.append({'id':r['id'],'card_id':int.from_bytes(hashlib.sha256(key.encode()).digest()[:7],'big'),'at':r['answered_at'],'rating':r['rating'],'received_at':r['received_at']})
    return result


def eligible(events):
    prior={}; counts=defaultdict(int); result=[]
    # clean_history already supplies the authoritative device/sequence tie order.
    # Stable sorting by time preserves it, as the pinned optimizer does.
    for e in sorted(events,key=lambda e:moment(e['at'])):
        c=e['card_id']; counts[c]+=1
        if c in prior and (moment(e['at'])-prior[c]).days>0 and counts[c]<=64: result.append(e)
        prior[c]=moment(e['at'])
    return result


def eligibility(events):
    outcomes=eligible(events)
    stats={'outcomes':len(outcomes),'cards':len({e['card_id'] for e in outcomes}),'failures':sum(e['rating']==1 for e in outcomes),'successes':sum(e['rating']!=1 for e in outcomes)}
    stats['eligible']=stats['outcomes']>=512 and stats['cards']>=30 and min(stats['failures'],stats['successes'])>=20
    return stats


def fit(events):
    from fsrs import Optimizer
    import torch
    torch.set_num_threads(2)
    stats=eligibility(events)
    if not stats['eligible']: return {'status':'insufficient_data','counts':stats}
    logs=[ReviewLog(card_id=e['card_id'],rating=Rating(e['rating']),review_datetime=moment(e['at']),review_duration=None) for e in events]
    params=list(Optimizer(logs).compute_optimal_parameters())
    if params==list(Scheduler().parameters): return {'status':'default_unchanged','counts':stats,'parameters':params}
    from fsrs.scheduler import LOWER_BOUNDS_PARAMETERS, UPPER_BOUNDS_PARAMETERS
    if len(params)!=21 or not all(math.isfinite(v) and lower<=v<=upper for v,lower,upper in zip(params,LOWER_BOUNDS_PARAMETERS,UPPER_BOUNDS_PARAMETERS)): raise ValueError('Invalid optimiser parameters')
    return {'status':'candidate','counts':stats,'parameters':params,'algorithm_version':ALGORITHM}


def predictions(events,parameters,after):
    engine=Scheduler(parameters=parameters,enable_fuzzing=False);cards={}; result={}
    for e in sorted(events,key=lambda e:moment(e['at'])):
        at=moment(e['at']);card=cards.setdefault(e['card_id'],Card(card_id=e['card_id'],due=at))
        if at>moment(after) and card.last_review and (at-card.last_review).days>0:
            p=min(1-1e-8,max(1e-8,float(engine.get_card_retrievability(card,current_datetime=at))))
            y=int(e['rating']!=1)
            result[e['id']]={'card_id':e['card_id'],'log_loss':-y*math.log(p)-(1-y)*math.log(1-p),'brier':(p-y)**2,'at':e['at'],'rating':e['rating'],'probability':p}
        cards[e['card_id']],_=engine.review_card(card,Rating(e['rating']),review_datetime=at)
    return result


def compare(events,parameters,baseline,after,*,minimum_days=14,max_outcomes=None,reporting_only=False):
    current=predictions(events,baseline,after);candidate=predictions(events,parameters,after)
    keys=[key for key in candidate if key in current]
    if max_outcomes is not None: keys=keys[:max_outcomes]
    counts={'outcomes':len(keys),'cards':len({candidate[k]['card_id'] for k in keys}),'failures':sum(candidate[k]['rating']==1 for k in keys),'successes':sum(candidate[k]['rating']!=1 for k in keys)}
    span=(max((moment(candidate[k]['at']) for k in keys),default=moment(after))-moment(after)).days
    if counts['outcomes']<100 or (not reporting_only and (counts['cards']<20 or min(counts['failures'],counts['successes'])<10 or span<minimum_days)):
        return {'status':'awaiting_validation','counts':counts,'elapsed_days':span}
    old_loss=mean(current[k]['log_loss'] for k in keys);new_loss=mean(candidate[k]['log_loss'] for k in keys)
    old_brier=mean(current[k]['brier'] for k in keys);new_brier=mean(candidate[k]['brier'] for k in keys)
    groups=defaultdict(list)
    for k in keys: groups[candidate[k]['card_id']].append(candidate[k]['log_loss']-current[k]['log_loss'])
    ids=sorted(groups);rng=random.Random(42);deltas=[]
    for _ in range(1000):
        sampled=[value for id in rng.choices(ids,k=len(ids)) for value in groups[id]]
        deltas.append(mean(sampled))
    deltas.sort();upper=deltas[974]
    activate=new_loss<=old_loss*.99 and new_brier<=old_brier and upper<0
    return {'status':'reported' if reporting_only else ('validated' if activate else 'rejected'),'counts':counts,'elapsed_days':span,'baseline_log_loss':old_loss,'candidate_log_loss':new_loss,'baseline_brier':old_brier,'candidate_brier':new_brier,'delta_95ci':[deltas[24],upper],'activate':False if reporting_only else activate,'used_for_activation':not reporting_only,'outcome_ids':keys}


if __name__=='__main__':
    import sys
    import signal
    # A killed Celery parent must not leave an unbounded training process.
    signal.alarm(900)
    payload=json.load(sys.stdin)
    print(json.dumps(fit(payload['events'])))
