# Evaluation artifacts and reproduction

The frozen experiment uses real local model outputs with constructed labels. **No language passes its release gate.** Tests, actual-model execution and hypothetical scheduling histories answer different questions; read [methodology and results](../docs/evaluation.md), [failures](../docs/failure-analysis.md) and [limitations](../docs/limitations.md) together.

## Artifact map

| Artifact | Purpose |
| --- | --- |
| [grading/manifest.json](grading/manifest.json) | Dataset counts, family split, seed, hash and label provenance |
| [grading/dataset.jsonl](grading/dataset.jsonl) | Complete 4,800 constructed inputs |
| [grading/ANNOTATION_GUIDE.md](grading/ANNOTATION_GUIDE.md) | Provisional labels and missing distributions |
| [grading/results/inference.jsonl](grading/results/inference.jsonl) | Genuine model features, spans, versions and timings |
| [grading/results/calibration/](grading/results/calibration/) | Frozen decision layer, per-language gates, metrics and ablations |
| [grading/results/gate-enforcement.json](grading/results/gate-enforcement.json) | Failed gates enforced through HTTP contracts |
| [grading/results/runtime-smoke.json](grading/results/runtime-smoke.json) | Actual isolated worker execution measurements |

Routine tests use controlled providers where appropriate. The opt-in checkpoint test and inference runner load actual models; the small smoke cannot calibrate or establish accuracy. [Detailed grading instructions](grading/README.md) describe the policy, retention and profiler semantics.

## Routine checks

Install the client and isolated Python environments using the [setup guide](../docs/setup.md). Run from the repository root:

```sh
bash scripts/verify.sh backend
backend/.venv/bin/python backend/scripts/generate_contracts.py --check
npm run typecheck
npm run test:ci -- --silent
npm run test:offline
npm run export:web
```

The routine backend suite skips the real-checkpoint test unless explicitly enabled. It does not substitute for the model experiment.

## Recheck preserved results

Write fresh outputs outside the frozen evidence paths. The following commands recompute calibration from the preserved complete inference and verify the failed release gates without loading models or touching the learner database:

```sh
mkdir -p /tmp/recallx-evaluation
backend/.venv-grading/bin/python evaluation/grading/calibrate.py --inference evaluation/grading/results/inference.jsonl --output /tmp/recallx-evaluation/calibration
backend/.venv/bin/python evaluation/grading/verify_gates.py --artifact evaluation/grading/results/calibration/calibration.json --output /tmp/recallx-evaluation/gate-enforcement.json
```

`verify_gates.py` expects the frozen all-failed artifact, an approved rubric and experimental opt-in in a temporary database. It prohibits model and generative-provider calls and checks nine durable uncertain attempts, zero review writes and three forced audio failures. It is an enforcement check, not inference.

## Run actual checkpoints

Provision pinned checkpoints explicitly, then run smoke or full inference into fresh paths. Normal inference uses local files. CPU FP32 is the recorded baseline; MPS requires separate parity and quality evaluation.

```sh
backend/.venv-grading/bin/python evaluation/grading/download_models.py
backend/.venv-grading/bin/python evaluation/grading/run_inference.py --output /tmp/recallx-evaluation/smoke.jsonl --limit 24
backend/.venv-grading/bin/python evaluation/grading/run_inference.py --output /tmp/recallx-evaluation/inference.jsonl
backend/.venv-grading/bin/python evaluation/grading/calibrate.py --inference /tmp/recallx-evaluation/inference.jsonl --output /tmp/recallx-evaluation/fresh-calibration
```

The 24-record smoke covers one family. Calibration requires every canonical example exactly once. Full inference resumes matching records by ID and holds the shared heavy-model lease; interactive model work waits while it runs. Preserve device, model/scorer revisions, dataset hash, resume count and cache conditions when comparing timings. The deterministic dataset generator is `grading/build_dataset.py`; it rewrites the canonical dataset and manifest, so run regeneration in a separate working copy when retaining frozen evidence.

For a short explicit actual-model test after provisioning:

```sh
RECALLX_RUN_REAL_MODELS=1 backend/.venv/bin/python -m pytest backend/tests/test_assessment_real_models.py -q
backend/.venv/bin/python evaluation/grading/profile_command.py --output /tmp/recallx-evaluation/runtime-process-tree.json -- backend/.venv/bin/python evaluation/grading/runtime_smoke.py --output /tmp/recallx-evaluation/runtime-smoke.json
```

The worker smoke bypasses decision gates to inspect evidence and process isolation; it makes no review writes and enables no language. Configure `RECALLX_GRADING_PYTHON` with the absolute isolated interpreter path for deployment. Even with an approved rubric, opt-in and `RECALLX_CALIBRATION_PATH`, the frozen failed gates retain abstention.

## Queue, OCR and synthetic scheduling

With local Redis installed, the queue smoke owns an isolated broker, worker and database. Drafts remain deterministic fixtures. The scheduler command uses the real optimiser with hypothetical outcomes and does not import them into learner data:

```sh
backend/.venv/bin/python backend/scripts/smoke_ingestion_queue.py --report /tmp/recallx-evaluation/redis-smoke.json
backend/.venv-grading/bin/python backend/scripts/synthetic_scheduler.py --output /tmp/recallx-evaluation/synthetic-scheduling.json
```

The scheduler uses reporting-only comparison and cannot request activation. See [the scheduling comparison](../docs/evaluation.md#scheduling-comparison) for historical measurements.

For OCR, provision the pinned models with `backend/.venv-ocr/bin/python backend/scripts/prepare_ocr_models.py` and use the isolated OCR/MLX environments described in [ingestion setup](../backend/ingestion/README.md). The OCR helper writes generated artifacts under the ignored `evaluation/local/ocr` directory:

```sh
backend/.venv/bin/python backend/scripts/smoke_ocr.py --accelerator cpu
backend/.venv/bin/python backend/scripts/smoke_ocr.py --accelerator mlx
```

The helper uses the Mac system Arial font and the MLX path requires host Metal access. Exact recognition of its two-sentence fixture is a compatibility result. New quality claims require reviewed, representative data and a new evaluation version.
