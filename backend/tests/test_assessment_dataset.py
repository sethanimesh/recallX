import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[2]


def test_synthetic_dataset_has_exact_counts_and_no_family_leakage():
    rows=[json.loads(line) for line in (ROOT/'evaluation/grading/dataset.jsonl').read_text().splitlines()]
    assert len(rows)==4800
    assert len({row['id'] for row in rows})==4800
    families={}
    for row in rows:
        families.setdefault(row['family_id'],set()).add(row['split'])
        assert row['experimental_only'] and not row['human_reviewed']
        assert row['label_provenance']=='synthetic_template_hypothesis'
    assert len(families)==200 and all(len(splits)==1 for splits in families.values())
    for language in ('en','hi','hi-Latn'):
        assert sum(row['language']==language for row in rows)==1600
    assert {split:sum(values=={split} for values in families.values()) for split in ('train','development','calibration','test')}=={'train':80,'development':40,'calibration':40,'test':40}


def test_calibration_refuses_partial_inference_before_loading_ml(tmp_path):
    path=tmp_path/'empty.jsonl';path.write_text('')
    result=subprocess.run([sys.executable,str(ROOT/'evaluation/grading/calibrate.py'),'--inference',str(path),'--output',str(tmp_path/'out')],capture_output=True,text=True)
    assert result.returncode!=0
    assert 'Full 4800-row' in result.stderr
    assert not (tmp_path/'out/calibration.json').exists()
