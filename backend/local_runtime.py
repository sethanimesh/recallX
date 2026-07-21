"""Serialize heavyweight inference across independent Mac worker processes."""
import asyncio
from contextlib import contextmanager, asynccontextmanager
import fcntl
import os
import time
import uuid
from ingestion.settings import DATA_DIR


@contextmanager
def inference_lease(priority='background'):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    waiting=DATA_DIR/'grading-waiters';waiting.mkdir(exist_ok=True)
    marker=waiting/f'{os.getpid()}-{uuid.uuid4()}' if priority=='grading' else None
    if marker: marker.touch()
    try:
        with (DATA_DIR / "inference.lock").open("a") as handle:
            while True:
                live=[]
                for item in waiting.iterdir():
                    try: os.kill(int(item.name.split('-')[0]),0);live.append(item)
                    except (ProcessLookupError,ValueError): item.unlink(missing_ok=True)
                    except PermissionError: live.append(item)
                if priority=='grading' or not live:
                    try:
                        fcntl.flock(handle.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
                        # A grading request arriving just before the lock wins the next page.
                        if priority!='grading' and any(waiting.iterdir()):
                            fcntl.flock(handle.fileno(),fcntl.LOCK_UN)
                        else: break
                    except BlockingIOError: pass
                time.sleep(.05)
            try:
                yield handle.fileno()
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    finally:
        if marker: marker.unlink(missing_ok=True)


@asynccontextmanager
async def async_inference_lease():
    """Cancelable lease acquisition without blocking the API event loop."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    waiting = DATA_DIR / 'grading-waiters'
    waiting.mkdir(exist_ok=True)
    with (DATA_DIR / "inference.lock").open("a") as handle:
        acquired = False
        try:
            while not acquired:
                live = False
                for marker in waiting.iterdir():
                    try:
                        os.kill(int(marker.name.split('-')[0]), 0)
                        live = True
                    except (ProcessLookupError, ValueError):
                        marker.unlink(missing_ok=True)
                    except PermissionError:
                        live = True
                if live:
                    await asyncio.sleep(0.1)
                    continue
                try:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    if any(waiting.iterdir()):
                        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
                        await asyncio.sleep(0.1)
                    else:
                        acquired = True
                except BlockingIOError:
                    await asyncio.sleep(0.1)
            yield handle.fileno()
        finally:
            if acquired:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
