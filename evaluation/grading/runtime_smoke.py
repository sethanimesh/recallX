"""Exercise the production async service and genuine model worker, without grading gates.

This validates process isolation and records latency; it does not establish answer
quality or enable live grading. It reads no learner data and performs no DB writes.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import resource
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'backend'))
from assessment.service import ModelService


async def smoke(output):
    rows = [json.loads(line) for line in Path(__file__).with_name('dataset.jsonl').read_text().splitlines()]
    chosen = [next(row for row in rows if row['language']==language and row['perturbation']=='clean')
              for language in ('en','hi','hi-Latn')]
    # The API parent can use the light environment; only its worker loads torch.
    os.environ.setdefault('RECALLX_GRADING_PYTHON', str(ROOT/'backend/.venv-grading/bin/python'))
    models = ModelService()
    measurements = []
    try:
        for row in chosen:
            before = time.monotonic()
            result = await models.infer(answer=row['answer'], word=row['word'], concepts=row['concepts'], rubric_key=row['family_id'])
            if result.get('error') or len(result.get('concept_results',[])) != len(row['concepts']):
                raise RuntimeError(f'Genuine worker did not return evidence: {result.get("error")}')
            measurements.append({'id':row['id'], 'language':row['language'],
                                 'wall_seconds':time.monotonic()-before, 'concept_results':result['concept_results']})
    finally:
        await models.close()
    usage = resource.getrusage(resource.RUSAGE_CHILDREN)
    report = {'source':'actual production worker with local pinned checkpoints', 'device':os.getenv('RECALLX_GRADING_DEVICE','cpu'),
              'requests':measurements, 'child_peak_rss_bytes':usage.ru_maxrss if sys.platform=='darwin' else usage.ru_maxrss*1024,
              'child_cpu_user_seconds':usage.ru_utime, 'child_cpu_system_seconds':usage.ru_stime,
              'method':'First request includes process creation and model load; subsequent requests reuse the worker. OS RUSAGE_CHILDREN high-water RSS is the single model worker, not an aggregate of simultaneous processes. The worker is killed and reaped before this report is written.',
              'limitation':'Three constructed clean examples prove execution only; quality gates are measured separately.'}
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='requests'},indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,required=True)
    asyncio.run(smoke(parser.parse_args().output))
