"""Explicit local checkpoint smoke; not part of routine provider-free unit tests."""
import json
import os
from pathlib import Path
import subprocess

import pytest

ROOT=Path(__file__).resolve().parents[2]


@pytest.mark.skipif(os.getenv('RECALLX_RUN_REAL_MODELS')!='1',reason='Enable explicitly after provisioning pinned local checkpoints')
def test_real_qwen_and_mdeberta_produce_finite_evidence(tmp_path):
    interpreter=os.getenv('RECALLX_GRADING_PYTHON',str(ROOT/'backend/.venv-grading/bin/python'))
    output=tmp_path/'real.jsonl'
    result=subprocess.run([interpreter,str(ROOT/'evaluation/grading/run_inference.py'),'--output',str(output),'--limit','24'],
        cwd=ROOT,env={**os.environ,'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1'},capture_output=True,text=True,timeout=300)
    assert result.returncode==0,result.stderr
    rows=[json.loads(line) for line in output.read_text().splitlines()]
    assert len(rows)==24
    assert {row['language'] for row in rows}=={'en','hi','hi-Latn'}
    for row in rows:
        assert len(row['features'])==5
        assert all(-1<=value<=1 for value in row['features'])
        assert len(row['concept_results'])==2
