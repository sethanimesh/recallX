"""Seeded hypothetical histories; never imports events into the personal database."""
import argparse
from datetime import datetime,timedelta,timezone
import json
from pathlib import Path
import random
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fsrs import Card,Scheduler,Rating
from services.optimization import fit,compare,predictions,eligibility

parser=argparse.ArgumentParser();parser.add_argument('--output',default='evidence/synthetic-scheduling.json');args=parser.parse_args()
rng=random.Random(73);start=datetime(2024,1,1,tzinfo=timezone.utc)
# This probability simulator deliberately represents a hypothetical learner, not observed outcomes.
latent=list(Scheduler().parameters);latent[0]*=.65;latent[1]*=.75;latent[2]*=.65;latent[3]*=.8
truth=Scheduler(parameters=latent,enable_fuzzing=False);cards={};events=[]
for day in range(50):
    for card_id in range(60):
        at=start+timedelta(days=day*2,minutes=card_id)
        card=cards.setdefault(card_id,Card(card_id=card_id,due=at))
        # A hypothetical 5% attention-lapse floor avoids implausibly perfect long-term recall.
        probability=min(.95,float(truth.get_card_retrievability(card,current_datetime=at))) if card.last_review else .65
        rating=3 if rng.random()<probability else 1
        events.append({'id':f'synthetic-{day}-{card_id}','card_id':card_id,'at':at.isoformat(),'rating':rating,'received_at':at.isoformat()})
        cards[card_id],_=truth.review_card(card,Rating(rating),review_datetime=at)
train=[e for e in events if e['at']<(start+timedelta(days=34)).isoformat()]
validation=[e for e in events if e['at']<(start+timedelta(days=68)).isoformat()]
from local_runtime import inference_lease
with inference_lease():
    result=fit(train)
report={'synthetic':True,'seed':73,'attention_lapse_floor':.05,'provenance':'Hypothetical simulated outcomes; no real learner evidence','counts':{'total':len(events),'training':eligibility(train)},'fit':result}
if result.get('parameters'):
    report['validation']=compare(validation,result['parameters'],list(Scheduler().parameters),max(e['at'] for e in train))
    report['test']=compare(events,result['parameters'],list(Scheduler().parameters),max(e['at'] for e in validation),reporting_only=True)
out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'output':str(out),'synthetic':True,'fit_status':result['status'],'eligible_training':eligibility(train)}))
