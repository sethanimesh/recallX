#!/usr/bin/env bash
set -euo pipefail

# Use the same provider-free checks locally and in CI.
recallx_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$recallx_root"
recallx_scope="${1:-all}"
case "$recallx_scope" in
  all|backend|client) ;;
  *) printf 'Usage: bash scripts/verify.sh [all|backend|client]\n' >&2; exit 2 ;;
esac

if [[ "$recallx_scope" == all || "$recallx_scope" == backend ]]; then
  if [[ -n "${RECALLX_PYTHON:-}" ]]; then
    recallx_python="$RECALLX_PYTHON"
  elif [[ -x backend/.venv/bin/python ]]; then
    recallx_python="$recallx_root/backend/.venv/bin/python"
  else
    recallx_python=python3
  fi

  "$recallx_python" - "$recallx_root" <<'PY'
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory

root = Path(sys.argv[1])
sys.path.insert(0, str(root / 'backend'))

# Ignore machine-specific configuration and private provider credentials.
for key in list(os.environ):
    if key.startswith('RECALLX_'):
        del os.environ[key]
for key in (
    'GROQ_API_KEY', 'GEMINI_API_KEY', 'MISTRAL_API_KEY', 'OPENROUTER_API_KEY',
    'HF_API_KEY', 'HUGGINGFACEHUB_API_TOKEN', 'HF_TOKEN', 'OPENAI_API_KEY',
    'OLLAMA_API_KEY',
):
    os.environ[key] = ''
os.environ.pop('PROVIDER_PRIORITY', None)
os.environ.update({
    'PYTHON_DOTENV_DISABLED': '1',
    'RECALLX_RUN_REAL_MODELS': '0',
    'RECALLX_DISABLE_DISPATCH': '1',
    'RECALLX_BOOTSTRAP_SECRET': 'verification-only-secret',
    'OLLAMA_BASE_URL': 'http://127.0.0.1:11434',
    'HF_HUB_OFFLINE': '1',
    'TRANSFORMERS_OFFLINE': '1',
})

with TemporaryDirectory(prefix='recallx-verification-') as directory:
    import database
    from ingestion import settings
    import local_runtime
    import pytest

    # Preserve per-test fixture overrides; an environment DB path would defeat them.
    database._DEFAULT_DB_PATH = str(Path(directory) / 'test.sqlite')
    settings.DATA_DIR = Path(directory) / 'assets'
    local_runtime.DATA_DIR = Path(directory) / 'runtime'
    result = pytest.main([str(root / 'backend/tests'), '-q'])
    if result:
        raise SystemExit(result)
    print('Checking generated API contracts...', flush=True)
    subprocess.run(
        [sys.executable, str(root / 'backend/scripts/generate_contracts.py'), '--check'],
        cwd=root, check=True,
    )
PY
fi

if [[ "$recallx_scope" == all || "$recallx_scope" == client ]]; then
  export CI=1
  export EXPO_NO_TELEMETRY=1
  npm run typecheck
  npm run test:ci -- --silent
  npm run test:offline
  npm run export:web
fi
