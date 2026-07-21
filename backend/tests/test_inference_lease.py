import os
from pathlib import Path
import subprocess
import sys
import time


def test_grading_waiter_runs_before_next_background_task(tmp_path):
    env={**os.environ,'RECALLX_DATA_DIR':str(tmp_path)}
    script='''
import os,sys,time
from local_runtime import inference_lease
with inference_lease(priority=sys.argv[1]):
    with open(os.path.join(os.environ['RECALLX_DATA_DIR'],'order'),'a') as f: f.write(sys.argv[1]+'\\n')
'''
    import local_runtime
    original=local_runtime.DATA_DIR
    local_runtime.DATA_DIR=tmp_path
    children=[]
    try:
        with local_runtime.inference_lease():
            children.append(subprocess.Popen([sys.executable,'-c',script,'grading'],env=env,cwd=Path(__file__).parents[1]))
            deadline=time.monotonic()+5
            while not list((tmp_path/'grading-waiters').iterdir()):
                assert time.monotonic()<deadline
                time.sleep(.01)
            children.append(subprocess.Popen([sys.executable,'-c',script,'background'],env=env,cwd=Path(__file__).parents[1]))
        for child in children: assert child.wait(timeout=5)==0
        assert (tmp_path/'order').read_text().splitlines()==['grading','background']
    finally:
        local_runtime.DATA_DIR=original
        for child in children:
            if child.poll() is None: child.kill();child.wait()
