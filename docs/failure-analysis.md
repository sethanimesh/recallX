# Failure analysis

The principal negative result is that the frozen grading experiment enables no language. This page distinguishes observed failures from hypotheses about their causes. Metrics and diagnostic examples come from the preserved [inference records](../evaluation/grading/results/inference.jsonl) and [evaluation](../evaluation/grading/results/calibration/evaluation.json).

## Clause order can create false contradiction evidence

English satisfies the precision and coverage point estimates but fails the noise gate: matched-baseline macro-F1 falls from 0.884872 to 0.772121 after replacing clean answers with clause-order variants. One test family makes the failure inspectable:

| Record ID | Constructed answer | Provisional label | Diagnostic policy outcome |
| --- | --- | --- | --- |
| `pessimistic:en:clean` | “expecting outcomes, to be unfavorable” | Correct | Correct, probability 0.931439 |
| `pessimistic:en:word_order` | “to be unfavorable; expecting outcomes.” | Correct | Incorrect, probability 0.693758, contradiction veto |

These outcomes are reconstructed using the frozen coefficients and `decide_probabilities` in [scoring.py](../backend/assessment/scoring.py). They show the development-selected policy before the failed language release gate. The live service returns uncertain for both because English is disabled.

For the reordered answer, the model assigns contradiction 0.980713 to the fragment “to be unfavorable;” against the required core concept “expecting outcomes.” The clean answer's maximum contradiction is 0.000809. The [inference implementation](../backend/assessment/inference.py) splits semicolon-separated clauses, checks each against every concept and preserves maximum contrary evidence. That mechanism protects against answers containing both support and contradiction, but this example shows a fragment being treated as a conflicting complete explanation. Fragment context is a plausible cause; the artifact does not isolate segmentation from model behavior in a controlled causal ablation.

The immediate mitigation is abstention through the failed release gate. A future development experiment could compare whole-answer context with clause evidence while retaining tests for genuine mixed contradictions. It requires reviewed examples and a new untouched test set before enabling a revised policy.

## Hindi and Hinglish cannot meet the operating policy

No development operating point meets both precision constraints, the contradiction limit and 70% coverage. Hindi's best coverage under the precision/contradiction constraints is 36.5625%; Hinglish has none. The selected policies abstain on all 320 test examples per language. Zero false passes at zero coverage does not demonstrate useful grading.

Unselective hybrid macro-F1 is 0.866622 for Hindi and 0.588386 for Hinglish, but an aggregate classifier score cannot establish an acceptable precision/coverage policy. The unreviewed translations, English-only references and template distribution limit diagnosis. The evidence does not establish whether model limitations, label ambiguity or their interaction dominates.

## Adding alignment does not consistently improve the classifier

NLI-only macro-F1 exceeds hybrid for English (0.867770 versus 0.859640) and Hindi (0.881433 versus 0.866622); hybrid is slightly higher for Hinglish (0.588386 versus 0.576487). Embedding-only results are substantially lower. The useful conclusion is that similarity alone is insufficient for this constructed task and hybrid benefit varies by slice. There is no evidence here for universal hybrid superiority.

## OCR execution depends on runtime compatibility

The preserved [MLX-VLM 0.3.11 attempt](../evidence/ocr/smoke-mlx-0.3.11-failure.json) failed after 460.421 seconds with a local pipeline error. The [0.7.3 smoke](../evidence/ocr/smoke-mlx.json) later recognized the same two-sentence fixture exactly with valid boxes. This supports the pinned runtime's compatibility on the recorded Mac, not a broad OCR-quality claim or proof of one isolated root cause. Keep the failure artifact and the frozen runtime dependencies together when investigating changes.

## Recovery checks test specific failure points

The real [queue smoke](../evidence/ingestion/redis-smoke.json) deliberately refuses a broker connection, kills its worker after committing a native-PDF page and redelivers the job. The outbox and checkpoint preserve one page and one candidate after recovery. [Review regressions](../backend/tests/test_central_reviews.py) check duplicate UUIDs, delayed offline reviews, resets and corrections. These are targeted reliability checks; they do not establish recovery from every disk, process or network failure.

The practical findings are to preserve contradiction evidence without assuming fragments are complete claims, evaluate precision together with coverage, and keep model compatibility separate from model quality. [Limitations](limitations.md) identifies the further evidence needed.
