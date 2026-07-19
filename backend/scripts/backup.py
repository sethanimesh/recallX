"""Create or verify a consistent SQLite backup; source assets remain in the data directory."""
import argparse
from pathlib import Path
import sqlite3
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import database
parser=argparse.ArgumentParser();parser.add_argument('destination');args=parser.parse_args()
path=Path(args.destination)
if path.exists():raise SystemExit('Destination already exists; choose a new path.')
path.parent.mkdir(parents=True,exist_ok=True)
with sqlite3.connect(f'file:{database.path()}?mode=ro',uri=True) as source,sqlite3.connect(path) as backup:
    source.backup(backup)
    assert backup.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
print(path)
