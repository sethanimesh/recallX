"""Resume real-checkpoint feature extraction. Never substitutes canned predictions."""
import argparse
import json
import os
from pathlib import Path
import resource
import sys
import time

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'backend'))
from assessment.inference import DiscriminativeModels,MODEL_VERSIONS
from assessment.scoring import features,SCORER_VERSION


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--dataset',type=Path,default=Path(__file__).with_name('dataset.jsonl'))
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--limit',type=int,default=0,help='Smoke only; partial output is rejected by calibration')
    args=parser.parse_args()
    rows=[json.loads(line) for line in args.dataset.read_text().splitlines() if line]
    canonical={row['id']:row for row in rows}
    if args.limit: rows=rows[:args.limit]
    done=set()
    if args.output.exists():
        for line in args.output.read_text().splitlines():
            row=json.loads(line)
            if row['model_versions']!=MODEL_VERSIONS or row['scorer_version']!=SCORER_VERSION or row['device']!=os.getenv('RECALLX_GRADING_DEVICE','cpu'):
                raise SystemExit('Refusing to mix inference versions')
            if row['id'] not in canonical or any(row.get(k)!=v for k,v in canonical[row['id']].items()):
                raise SystemExit('Saved inference belongs to a changed dataset; preserve it separately before restarting.')
            done.add(row['id'])
    args.output.parent.mkdir(parents=True,exist_ok=True)
    resumed=len(done)
    processed=0
    from local_runtime import inference_lease
    started=time.monotonic()
    with inference_lease():
        models=DiscriminativeModels()
        cold=time.monotonic()-started
        with args.output.open('a') as out:
            for number,row in enumerate(rows):
                if row['id'] in done: continue
                before=time.monotonic()
                result=models.assess(row['answer'],row['word'],row['concepts'],row['family_id'])
                record={**row,'features':features(result),'concept_results':result,'model_versions':MODEL_VERSIONS,
                        'scorer_version':SCORER_VERSION,'device':models.device,'elapsed_seconds':time.monotonic()-before}
                out.write(json.dumps(record,ensure_ascii=False)+'\n');out.flush()
                processed+=1
                if number%24==0: print(f'{number+1}/{len(rows)} real-model records; last {record["elapsed_seconds"]:.2f}s',flush=True)
    all_records=[json.loads(line) for line in args.output.read_text().splitlines() if line]
    summary={'records':len(all_records),'resumed_records':resumed,'processed_this_invocation':processed,
             'cold_load_seconds':cold,'invocation_elapsed_seconds':time.monotonic()-started,
             'sum_record_compute_seconds':sum(row['elapsed_seconds'] for row in all_records),
             'peak_process_rss_bytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
             'model_versions':MODEL_VERSIONS,'device':models.device,'source':'actual local checkpoint inference',
             'limitation':'Synthetic examples; smoke is not calibration or proof of learner quality.'}
    args.output.with_suffix('.summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary,indent=2))


if __name__=='__main__': main()
