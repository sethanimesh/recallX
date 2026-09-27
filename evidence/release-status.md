# RecallX personal Mac release evidence

Recorded 28 September 2026. This pack separates implemented software, controlled tests, actual model execution, synthetic experiments and learner evidence. The starting revision was `6ea2f3e` plus the preserved local TV changes; the implementation is the current working tree.

## Implemented mechanisms

| Workstream | Delivered behavior | Evidence |
| --- | --- | --- |
| Foundation and storage | Numbered, checksum-checked migrations; automatic verified pre-migration backups; foreign keys, WAL and bounded lock waiting; stable item IDs, senses and content revisions | [Baseline](baseline.md), [458-item migration rehearsal](migration-rehearsal.json) |
| Identity and contracts | One learner, revocable paired devices, TV pairing codes, server-owned references, Pydantic/OpenAPI-generated client schemas | `backend/auth.py`, `backend/openapi.json`, `src/api/generated.ts` |
| Learning history | Immutable review facts, UUID acknowledgments, separate recall/flashcard FSRS cards, chronological replay, configuration versions, corrections, reset generations and tombstones | `backend/tests/test_central_reviews.py` |
| Durable clients | Native transactions; SQL.js/IndexedDB commit and rollback; cross-tab coordination; locally bundled WASM and offline web shell; pending review/draft persistence; durable library, pairing, reset and import operations | [Platform checks](platforms.md), [browser recovery](web-recovery.md) |
| Grading | Pinned Qwen3 embeddings and FP32 mDeBERTa NLI; concept alignment, separate contradiction evidence, supervised decision layer, calibrated probabilities, abstention, evidence templates and assisted-practice handling | [Grading report](grading-report.md) |
| Ingestion | Real file-byte uploads, durable assets, native PDF text and full PaddleOCR-VL 1.6 with CPU layout/MLX recognition, page geometry/citations, resumable candidates and atomic approval | [Real MLX smoke](ocr/smoke-mlx.json), [real broker/worker recovery](ingestion/redis-smoke.json) |
| Personalisation infrastructure | Eligible-history filters, real FSRS optimiser jobs, frozen snapshots, validation/holdout separation, parameter activation/rollback and unchanged visible due dates until the next review | `backend/services/optimization.py`, `backend/services/optimization_tasks.py`, [synthetic demonstration](synthetic-scheduling.json) |
| Export and recovery | Complete learning-history JSON with assessment/model/calibration status, review facts, corrections, settings versions and provenance; separate binary-asset backup | `GET /export`, `backend/scripts/backup.py` |

Generative providers remain available for content drafting and teaching. Recall and tutor grading have no generative judge or fallback. The shared inference lease prioritises waiting graders between background pages, and owned model workers/services terminate to release memory.

Library edits and device operations retain UUID receipts. Import uploads preserve their original bytes and UUID locally before transmission; source corrections retain immutable before/after revisions. Job controls and candidate drafts use explicit revisions, and an unacknowledged approval freezes its submitted choices. The optimiser child retains the shared inference lock after parent death and has its own bounded termination deadline.

## Grading release decision

All 4,800 synthetic examples were evaluated with the actual pinned local checkpoints. The frozen artifact enables **no language**: English exceeded the permitted noise degradation, while Hindi and Hinglish had no development operating point meeting the full precision/coverage policy. Thresholds were not changed after observing final test results.

English accepted 286/320 test decisions with 95.105% overall accepted precision, 96.575% precision among predicted-correct answers and zero contradiction passes among 80 contradiction examples. Its worst noise macro-F1 drop was 11.275 percentage points, above the five-point limit. Hindi and Hinglish abstain under their selected policies. See the report for confidence intervals, calibration, all ablations and the limitations of constructed labels.

Consequently, the explicit experimental setting cannot override these failed gates. Semantic assessments remain uncertain and do not alter memory state. Self-rated flashcard review is available for collecting clean history. The rubric approval, model service, calibration loader and gating mechanisms are implemented; validated multilingual robustness is not established by this experiment.

## Scheduling demonstration and real learner boundary

The isolated, seeded hypothetical dataset contains 3,000 events across 60 cards with a declared 5% attention-lapse floor. The actual pinned optimiser fitted 960 eligible training outcomes. On its later synthetic validation window, log loss changed from 0.217930 to 0.194023 and Brier score from 0.042862 to 0.042818; the paired-by-card log-loss difference interval was [-0.034499, -0.013699]. The untouched synthetic reporting window changed log loss from 0.266717 to 0.234112 and Brier score from 0.055109 to 0.053863.

These are synthetic prediction results. No synthetic events or fitted weights were inserted into the personal learner database. Real personalisation still requires 512 eligible training outcomes across 30 cards, including 20 successes and 20 failures, subsequent validation with at least 100 outcomes over 14 days, and another 100 outcomes reserved for reporting. No improvement in an actual learner's retention or review burden is claimed.

## Integration and measured execution

- The final backend suite passed 222 tests, with one opt-in checkpoint test kept separate from the completed actual-model evaluation. TypeScript and generated-contract drift checks passed. [Verification record](final-verification.json) records the commands and regression scope; [platform checks](platforms.md) records client tests and builds.
- The migration rehearsal applied all nine migrations, retained all 458 original item IDs and passed SQLite integrity and foreign-key checks. The user's live database was not modified by the rehearsal.
- A controlled cross-service journey uploads real PDF bytes, parses native text, inspects citations, approves/rejects candidates, approves a rubric, exercises the real frozen abstention gate, commits a self-rating, retries its acknowledgment and observes identical state through a second paired device. Draft generation is a fixture; provider keys are disabled. See `backend/tests/test_learning_journey.py`.
- Real Redis/Celery execution recovered from broker refusal and a killed worker after a durable page checkpoint. Duplicate delivery retained one page and one candidate. Draft generation in this recovery check is explicitly controlled.
- Full CPU-layout/MLX recognition returned the two reference sentences exactly with valid boxes in 22.719 seconds, including startup and queue time. This is a compatibility fixture, not a broad OCR-quality benchmark. Sampled process RSS excludes separately accounted Metal allocations.
- The actual grading worker measured 11.390 seconds for its first request and 0.644/0.322 seconds for the next two requests. Sampled process-tree RSS peaked at 2.576 GB. The report explains sampling limits and the separate full-run high-water mark.
- During real-model evaluation, the isolated two-item API fixture measured 4.55 ms median and 11.06 ms p95 for 40 sequential authenticated snapshots. [Workload and measurements](api-responsiveness.json) describe its narrow scope.
- [Platform evidence](platforms.md) names each completed Expo/native/browser check and the exact artifacts used.

## Claim boundary

The code and evidence establish the implemented mechanisms and the measured experiments above. The proposed résumé bullets are not marked fully substantiated: multilingual robustness and learner-specific personalisation require their respective quality and real-history evidence. Synthetic labels, controlled tests and successful startup/build checks are identified explicitly throughout this pack.

Use the [setup and recovery guide](../docs/setup.md) to run the personal deployment. Raw answers and original assets are retained locally until explicit deletion; complete backups include both SQLite and the source data directory.
