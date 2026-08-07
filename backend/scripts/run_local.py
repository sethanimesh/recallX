"""Run RecallX's owned local processes; Ctrl-C stops only this process group."""
import argparse
import os
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import sys
import time

backend=Path(__file__).resolve().parents[1];root=backend.parent
parser=argparse.ArgumentParser();parser.add_argument('--host',default='0.0.0.0');parser.add_argument('--port',type=int,default=8000);parser.add_argument('--web',action='store_true');args=parser.parse_args()
python=backend/'.venv/bin/python';redis=shutil.which('redis-server')
if not python.exists() or not redis:raise SystemExit('Run setup first: backend/.venv and redis-server are required. See README.')
env=os.environ.copy();data=Path(env.setdefault('RECALLX_DATA_DIR',str(backend/'data')));data.mkdir(parents=True,exist_ok=True)
(data/'redis').mkdir(exist_ok=True);(data/'logs').mkdir(exist_ok=True);(data/'backups').mkdir(exist_ok=True)
env.setdefault('RECALLX_REDIS_URL','redis://127.0.0.1:6380/0')
env.setdefault('RECALLX_GRADING_PYTHON',str(backend/'.venv-grading/bin/python'))
env.setdefault('RECALLX_OPTIMIZER_PYTHON',str(backend/'.venv-grading/bin/python'))
env.setdefault('RECALLX_OCR_PYTHON',str(backend/'.venv-ocr/bin/python'))
env.setdefault('RECALLX_MLX_PYTHON',str(backend/'.venv-mlx/bin/python'))
env.setdefault('RECALLX_OCR_ACCELERATOR','mlx')
model_root=root/'models';env.setdefault('RECALLX_MODEL_ROOT',str(model_root))
db=Path(env.get('RECALLX_DB_PATH',str(backend/'db.sqlite')))
if db.exists():
    with sqlite3.connect(f'file:{db}?mode=ro',uri=True) as source,sqlite3.connect(data/'backups'/f'{int(time.time())}.sqlite') as backup:source.backup(backup)
children=[];logs=[]

def spawn(name,cmd):
    stream=(data/'logs'/f'{name}.log').open('a');logs.append(stream)
    child=subprocess.Popen(cmd,cwd=backend,env=env,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
    children.append((name,child));print(f'{name} started; log: {data / "logs" / (name+".log")}',flush=True)

try:
    spawn('redis',[redis,'--bind','127.0.0.1','--port','6380','--dir',str(data/'redis'),'--appendonly','yes','--save','60','1'])
    time.sleep(.5)
    spawn('worker',[str(python),'-m','celery','-A','ingestion.tasks:celery_app','worker','--pool=solo','--concurrency=1','-Q','celery,optimization','--loglevel=INFO'])
    spawn('api',[str(python),'-m','uvicorn','main:app','--host',args.host,'--port',str(args.port)])
    if args.web:
        if not (root/'dist/index.html').exists():raise RuntimeError('Build web first: npm run export:web')
        spawn('web',[str(python),str(backend/'scripts/serve_web.py'),'--port','8082','--host','127.0.0.1','--directory',str(root/'dist')])
    print(f'API: http://{args.host}:{args.port}; pair using {data / "bootstrap.secret"}',flush=True)
    while True:
        for name,child in children:
            if child.poll() is not None:raise RuntimeError(f'{name} exited with {child.returncode}; inspect its log')
        time.sleep(1)
except KeyboardInterrupt:pass
finally:
    for _,child in reversed(children):
        if child.poll() is None:os.killpg(child.pid,signal.SIGTERM)
    for _,child in children:
        try:child.wait(timeout=5)
        except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL)
    for stream in logs:stream.close()
