# Grading evidence — 28 September 2026

**All three experimental release gates failed. Live semantic decisions remain `uncertain`; no language is enabled by this artifact.** The models, trained decision layer, calibration and gates ran on actual local checkpoints. These results concern constructed labels, not independently reviewed learner answers.

## Frozen experiment

The dataset contains 200 vocabulary families × eight variants × three answer languages = 4,800 examples. English reference concepts are shared across English, Hindi and Hinglish answers. Families are split 80/40/40/40 for training/development/calibration/test; distractor text also stays inside its partition. Labels and translations are unreviewed construction hypotheses. All 4,800 genuine model outputs are present and were checked against canonical inputs before fitting.

Before any calibration, a data audit restricted unrelated distractors to their own partition. Affected feature records were recomputed; unchanged records were reused. The hashes below identify the corrected complete dataset and inference only.

Training fits multinomial logistic regression; the separate calibration partition fits temperature (1.023691). Development selects acceptance and contradiction-veto thresholds. English selected 0.63 acceptance and 0.60 veto. Hindi/Hinglish found no qualifying policy and therefore use abstention. The final test was evaluated once; thresholds were preserved after observing failure.

| Hybrid test slice | Accepted decisions | Overall accepted precision | Predicted-correct precision | Contradiction false passes | Worst noisy macro-F1 drop | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| English | 286/320 (89.375%) | 272/286 (95.105%) | 141/146 (96.575%) | 0/80 | 0.112751 | Fail: drop exceeds 0.05 |
| Hindi | 0/320 | Undefined | Undefined | 0/80 | 0 under abstention | Fail: no development policy; coverage below 70% |
| Hinglish | 0/320 | Undefined | Undefined | 0/80 | 0 under abstention | Fail: no development policy; coverage below 70% |

English macro-F1 on the matched clean/partial/negative baseline is 0.884872; replacing clean answers with clause-order perturbations reduces it to 0.772121. Framing typos did not reduce it in this experiment. On Hindi development examples, the greatest coverage meeting both precision constraints and the contradiction limit was 36.5625%; Hinglish had no qualifying operating point. Zero errors under all-abstention are not evidence of useful grading.

The gates use point estimates: both accepted-decision and predicted-correct precision ≥95%, contradiction false-pass ≤2%, coverage ≥70%, and noisy macro-F1 degradation ≤0.05. English Wilson 95% intervals are 91.952–97.062% for accepted precision and 92.234–98.528% for predicted-correct precision. The interval for 0/80 contradiction false passes is 0–4.582%; this sample does not establish a population risk below 2%.

## Ablation comparison

The following unselective macro-F1 scores diagnose the classifiers before abstention. Each ablation was separately trained and calibrated using the same partitions. They do not imply an enabled policy or consistent hybrid superiority.

| Variant | English | Hindi | Hinglish |
| --- | ---: | ---: | ---: |
| Embedding only | 0.353670 | 0.386393 | 0.253912 |
| NLI only | 0.867770 | 0.881433 | 0.576487 |
| Hybrid | 0.859640 | 0.866622 | 0.588386 |

The detailed report includes selective metrics, counts, false accepts/rejects, Brier scores, calibration bins, concept measurements, paired perturbations and per-language risk/coverage curves. Broad synonyms, variable-size rubrics and natural OCR/ASR noise remain outside this constructed test's coverage.

## Local execution measurements

CPU FP32 ran on the local arm64 Mac (reported OS: macOS 27.0). The full evaluation's final invocation resumed 702 unchanged records and computed the remaining 4,098: 1,643.10 seconds including an 8.35-second cold load. All-record compute times sum to 1,837.18 seconds; the final invocation is not total experiment wall time. Median per-example wall time was 0.243 seconds, p95 0.673, p99 1.578, maximum 134.002 seconds under shared-machine load. Full-run process RSS high-water mark was 3.591 GB. Reference embeddings were cached and earlier interruptions are disclosed in the summary.

A separate production-service check used the light API interpreter and a real isolated grading worker, with no review writes. Its first request took 11.390 seconds including worker creation/model loading; the next Hindi/Hinglish requests took 0.644/0.322 seconds. Worker user/system CPU time was 4.038/4.338 seconds. Worker OS peak RSS was 2.542 GB. Aggregate recursive-process-tree RSS sampled every 0.2 seconds peaked at 2.576 GB; three processes were observed. Shared pages may be counted twice and brief peaks may be missed. The worker was killed/reaped before the report was written, releasing the shared heavy-model lease. These are execution measurements, not quality results.

## Activation and reproducibility

The actual frozen artifact was exercised through temporary-database HTTP requests with experimental opt-in enabled and an approved rubric. Assessment and both tutor endpoints returned `uncertain`/`calibration_unavailable` for English, Hindi and Hinglish, made zero model calls, persisted nine assessment attempts and wrote zero reviews. Nine generative-provider credential variables were explicitly blanked before imports; instrumented provider construction and chat-completion calls both remained zero. Forced audio failures on all three speech requests preserved the completed assessments. Tutor/assisted assessments remain practice-only. The grading/dataset/provider/tutor regression suite passed 66 tests; one separate opt-in model test was skipped because the genuine full experiment and production smoke were run explicitly.

A final regression fix ensures a conflicting qualifier or misconception cites the clause that supplied its evidence. It does not change the numeric features or decision policy; these dataset rubrics express qualifiers as separate atomic concepts, so the frozen inference and calibration remain unchanged.

Artifact ID: `5572ac4e546b40ae3a7800f7`.

Dataset SHA-256: `0f6fb76feb8a5193e8cc788aefce1ec243b94d4a35ed2ab08c1098ff253f1141`.

Inference SHA-256: `5572ac4e546b40ae3a7800f7bf41993cc40488ce904cd323c491f494e024e239`.

Pinned checkpoints: Qwen3-Embedding-0.6B at `97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3`; mDeBERTa-v3-base-xnli-multilingual-nli-2mil7 at `b5113eb38ab63efdd7f280f8c144ea8b13f978ce`. Dependencies are frozen in [requirements-grading-lock.txt](../backend/requirements-grading-lock.txt).

- [Calibration artifact](../evaluation/grading/results/calibration/calibration.json), [complete evaluation](../evaluation/grading/results/calibration/evaluation.json).
- [Genuine inference records](../evaluation/grading/results/inference.jsonl), [timing summary](../evaluation/grading/results/inference.summary.json).
- [Production-worker smoke](../evaluation/grading/results/runtime-smoke.json), [process-tree samples](../evaluation/grading/results/runtime-process-tree.json), [gate enforcement check](../evaluation/grading/results/gate-enforcement.json).
- [Dataset manifest](../evaluation/grading/manifest.json), [annotation guide](../evaluation/grading/ANNOTATION_GUIDE.md), [commands and methodology](../evaluation/grading/README.md).

No release gate was weakened and no passing slice was invented. Improving the system requires another versioned development iteration and an appropriately untouched evaluation; these results do not substantiate a claim of validated multilingual robustness.
