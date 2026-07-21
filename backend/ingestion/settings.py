import os
from pathlib import Path

DATA_DIR = Path(os.getenv("RECALLX_DATA_DIR", str(Path(__file__).resolve().parents[1] / "data")))
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_PAGES = 100
MAX_IMAGE_PIXELS = 20_000_000
MAX_CANDIDATES = 300
CHUNK_CHARACTERS = 4000
LEASE_SECONDS = 900
