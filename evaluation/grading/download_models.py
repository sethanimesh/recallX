"""Explicit provisioning only. The API and workers never download on a review request."""
import os
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'backend'))
from assessment.inference import EMBEDDING_ID,EMBEDDING_REVISION,NLI_ID,NLI_REVISION


def main():
    from huggingface_hub import snapshot_download
    for name,revision in ((EMBEDDING_ID,EMBEDDING_REVISION),(NLI_ID,NLI_REVISION)):
        path=snapshot_download(name,revision=revision,
            allow_patterns=['*.json','*.safetensors','*.model','*.txt','merges.txt','vocab.json','1_Pooling/*'],max_workers=2)
        print(name,revision,path,flush=True)


if __name__=='__main__': main()
