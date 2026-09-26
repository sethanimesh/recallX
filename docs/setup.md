# Setup and operation

A personal vocabulary library with centrally persisted review history, FSRS-6 scheduling, discriminative semantic assessment, and resumable document ingestion. Phone, browser and Android TV clients share one learner identity. Android TV uses self-rated flashcards.

## What is authoritative

FastAPI owns items, approved concept rubrics, assessments, review events and memory states. Python FSRS 6.3.2 computes every due date. Clients retain a durable cache and a UUID-based pending-review queue. Offline self-ratings show **schedule pending** until acknowledged; typed answers remain drafts.

Qwen3 embeddings and mDeBERTa NLI are the only grading models. Tutor practice uses the same assessment service but does not schedule reviews. Generative providers can draft extraction/teaching content; they cannot decide correctness. Synthetic calibration is experimental and never counts as human validation. Missing models, missing approved rubrics, failed language gates and service failures abstain without recording forgetting.

## Local setup (Apple Silicon)

Run commands from the repository root. Use native Python 3.11, Node.js 22, and Redis. The lighter [demo](demo.md) needs only the base API environment and does not download models. The commands below also require installed `uv` and Homebrew (`brew`); omit the Redis installation command if Redis is already available. The API, PyTorch grader, PaddleOCR layout pipeline and MLX recognizer run in separate environments. Existing generated ios/android folders are not safe places to switch phone/TV build targets; use separate build copies.

```sh
uv venv --python 3.11 backend/.venv
uv pip install --python backend/.venv/bin/python -r backend/requirements.lock.txt
npm ci
brew install redis
uv venv --python 3.11 backend/.venv-grading
uv pip install --python backend/.venv-grading/bin/python -r backend/requirements-grading-lock.txt
uv venv --python 3.11 backend/.venv-ocr
uv pip install --python backend/.venv-ocr/bin/python -r backend/requirements-ocr.lock.txt
uv venv --python 3.11 backend/.venv-mlx
uv pip install --python backend/.venv-mlx/bin/python -r backend/requirements-mlx.lock.txt
```

See [`backend/.env.example`](../backend/.env.example) for runtime overrides. Export environment variables before starting; optional provider credentials belong in the ignored `backend/.env.local`. Store model checkpoints locally; inference never silently downloads a different revision or falls back to a generative judge.

```sh
backend/.venv-grading/bin/python evaluation/grading/download_models.py
backend/.venv-ocr/bin/python backend/scripts/prepare_ocr_models.py
npm run export:web
backend/.venv/bin/python backend/scripts/run_local.py --web
```

The supervisor runs its own Redis on **127.0.0.1:6380**, a bounded Celery worker, API on port 8000 and browser preview at **http://localhost:8082**. It creates a SQLite backup before startup and stops only its own processes on Ctrl-C. The database also creates and verifies a backup before applying new migrations and serializes migration runners. Logs are under `backend/data/logs`. Avoid running two supervisors against the same ports/data directory.

Browser storage requires a secure browser context (localhost or HTTPS), IndexedDB and Web Locks. WASM is bundled with the static export. For access from another computer, serve the static files over HTTPS and add that origin to `RECALLX_WEB_ORIGINS`. Native phones and TV use the Mac's LAN API address. This setup is for a private local network, not public internet deployment.

## Pair devices and start learning

Open **Connection and sync**, set the API URL (`http://localhost:8000` for a browser on the server machine; use the server’s LAN IP on a phone or TV), and pair the first device using the value in `backend/data/bootstrap.secret` (created with owner-only permissions). Subsequent devices display a short-lived code; approve that code on a paired device. Devices can be revoked centrally.

Sync the library before practising offline. Choose **Self-rated review** to collect clean history immediately. Reveal after attempting recall, then select Again or Good. Accepted reviews save immediately, before Next. Pending acknowledgements survive restart and replay using the original UUID.

For semantic recall, open a word's rubric screen, edit the required concepts and approve the revision. Choose English, Hindi or Hinglish for the answer. Experimental grading additionally requires a passing calibration artifact configured in `RECALLX_CALIBRATION_PATH` and the visible experimental setting. Clarification after feedback is assisted practice.

The learning settings screen controls desired retention (default 90%, allowed 70–99%). Changes apply to future review transitions. Queued reviews retain their original settings and parameter versions. Reset advances a progress generation and keeps historical facts; delayed queued work cannot restore an old generation. Corrections append audit records and rebuild the affected state. Distinct concurrent attempts are replayed chronologically; the receipt identifies reconciliation when its expected state version differed.

## Document jobs

Upload actual PDF/image bytes or submit text. Files, original/cropped relationships, hashes, pages, blocks and reading order persist under the data directory. Native-text PDF pages use PyMuPDF; scanned pages use the full PaddleOCR-VL 1.6 layout pipeline. The queue stores IDs, and a database outbox recovers broker failures.

Jobs expose progress, retry, cancellation, source preview, text correction and resumable acceptance. Upload bytes and their request UUID are saved locally before transmission; Add Words exposes unacknowledged uploads for retry after restart. Draft saves and job controls check revisions, source corrections preserve their before/after history, and a submitted candidate approval remains frozen until its acknowledgment is resolved. General documents and vocabulary-MCQ sources are distinct modes. Accepted items retain passage citations; these are not fabricated exact word alignments. Generated rubrics remain drafts until explicitly approved.

The default runs full PaddleOCR-VL 1.6 with CPU layout and local MLX recognition. The supervisor uses pinned models under `backend/models/ocr`; `RECALLX_OCR_LAYOUT_DIR` and `RECALLX_OCR_MODEL_DIR` override these paths. Each page owns a loopback MLX service, terminates it before releasing the shared inference lock, and lets waiting grading requests run before the next page. `RECALLX_OCR_ACCELERATOR=cpu` selects the separately tested full CPU pipeline. The [real MLX smoke](../evidence/ocr/smoke-mlx.json) recognized its two English sentences exactly with valid source boxes. That small compatibility check does not establish broad document quality. Its sampled process RSS excludes separately accounted Metal allocations and must not be treated as total GPU memory use.

## Evaluation and honest evidence

`evaluation/grading/dataset.jsonl` contains 4,800 constructed examples: 200 families × 8 answer types × 3 languages. Families, including translated/perturbed variants, stay within one of the fixed 40/20/20/20 partitions. Labels are synthetic hypotheses, not independently reviewed ground truth.

```sh
backend/.venv-grading/bin/python evaluation/grading/build_dataset.py
backend/.venv-grading/bin/python evaluation/grading/run_inference.py --output evaluation/local/grading-inference.jsonl
backend/.venv-grading/bin/python evaluation/grading/calibrate.py --inference evaluation/local/grading-inference.jsonl --output evaluation/local/grading
backend/.venv-grading/bin/python backend/scripts/synthetic_scheduler.py --output evaluation/local/synthetic-scheduling.json
```

Calibration rejects partial inference runs and model/split drift. Thresholds come from development data, calibration from its dedicated partition, and final gates from untouched test families. Failed language gates keep that language uncertain; a synthetic success still does not establish real-learner robustness.

Personal parameter fitting excludes experimental, assisted, corrected/untrusted histories and requires at least 512 qualifying later-day training outcomes across 30 cards. Fitting runs outside API interactions, with a 15-minute process timeout. Subsequent validation must include 100 outcomes over at least 14 days, enough successes/failures and a statistically supported improvement. The next 100 outcomes after frozen validation are reserved for reporting through `/optimizations/{parameter_version}/report`; they never control activation. New fits run at most weekly and require 100 additional eligible outcomes. Activation/rollback is versioned and preserves current visible due dates until the next review. Each activation explicitly rebuilds preceding history under the selected weights; reviews answered after that boundary use their recorded parameter version, including delayed offline submissions from a device that still held the previous preset. The synthetic simulator is isolated and never inserts examples into your learner database.

## Checks and recovery

```sh
bash scripts/verify.sh backend
npm run typecheck
npm run test:ci
npm run export:web
backend/.venv/bin/python backend/scripts/generate_contracts.py --check
backend/.venv/bin/python backend/scripts/backup.py /absolute/path/to/new-backup.sqlite
```

`backend/openapi.json` and `src/api/generated.ts` are generated from Pydantic/OpenAPI. Regenerate without `--check` after intentional contract changes. Migration checksums prevent silently changing already-applied migrations.

For restore, stop the local supervisor, preserve the current database and data directory, restore a consistent backup to `RECALLX_DB_PATH`, then restart and resync clients. Retain source assets alongside the database. Review UUIDs make retries safe; restoring an older backup cannot recover events newer than that backup unless clients still retain those operations.

The complete-learning-history JSON export includes assessments, immutable reviews, corrections, rubrics, settings revisions, parameters, job records and provenance. It excludes pairing credentials and references original assets by authenticated download URL. Preserve the data directory separately for a full asset backup. CSV is a filtered vocabulary export.

See [baseline](../evidence/baseline.md), [release status](../evidence/release-status.md) and the individual model/platform reports for completed checks and outstanding gates. The earlier local build commands are preserved in `evidence/previous-build-notes.md`.
