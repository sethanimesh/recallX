"""Single owned MLX service, with no development reloader or persistent model."""
import os
from pathlib import Path
import signal
import sys


if __name__ == "__main__":
    # The lease FD is inherited. A lost parent must not leave a resident model.
    signal.alarm(360)
    root = Path(__file__).resolve().parents[1]
    os.environ.setdefault("HF_HOME", str(root / "models" / "hf-cache"))
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["MLX_TRUST_REMOTE_CODE"] = "true"
    import mlx.core as mx
    # MLX calls its memory limit a guideline, not a hard process RSS cap.
    # Bound idle allocator caching and avoid requesting wired-memory changes.
    mx.set_memory_limit(6 * 1024 ** 3)
    mx.set_cache_limit(256 * 1024 ** 2)
    import uvicorn
    from mlx_vlm.server import app
    uvicorn.run(app, host="127.0.0.1", port=int(sys.argv[1]), workers=1, log_level="info")
