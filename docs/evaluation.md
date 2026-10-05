# Evaluation

The repository has evidence for storage, recovery, model execution and a constructed grading experiment. **The frozen semantic-grading artifact fails every language release gate.** Self-rated flashcards remain the usable scheduling path; the experiment does not establish learning gains or validated multilingual grading.

## Questions and evidence

| Question | Method | Evidence boundary |
| --- | --- | --- |
| Are reviews durable and retries safe? | API/database and client regressions; controlled multi-device journey | Checks specified failure scenarios, not long-term production reliability |
| Can document imports recover? | Real native-PDF parsing, Redis and Celery worker interruption | Draft generation is a deterministic fixture |
| Can local models execute? | Actual pinned checkpoints and isolated worker profiling | Execution success does not establish answer quality |
| Is semantic grading accurate enough to enable? | Family-disjoint constructed dataset, calibrated policy and fixed gates | Labels and translations have no independent human review |
| Does parameter fitting improve prediction? | Seeded hypothetical histories versus default FSRS parameters | Synthetic prediction quality, not real learner retention |

The verification record records 222 backend tests passed with one opt-in model test skipped, 51 client suites with 335 tests passed, type checking and generated-contract checks. The separately recorded real-model runs supply the model-execution evidence. Platform evidence records browser and iPhone simulator checks; Android phone/TV evidence covers configuration generation, not completed device builds or runtime testing.

## Semantic-grading protocol

[Dataset and manifest](../evaluation/grading/manifest.json): 200 vocabulary families × eight answer variants × English, Hindi and Roman-script Hinglish = 4,800 examples. The variants are clean, paraphrase, typo, clause order, partial, negation, unrelated and mixed support/contradiction. All reference concepts are English. Every family and its variants remain together in one split; unrelated distractors also stay within that split.

| Partition | Families | Examples | Role |
| --- | ---: | ---: | --- |
| Training | 80 | 1,920 | Fit multinomial logistic regression |
| Development | 40 | 960 | Select per-language acceptance and contradiction-veto thresholds |
| Calibration | 40 | 960 | Fit probability temperature |
| Test | 40 | 960 | Evaluate frozen policies and release gates |

Qwen3-Embedding-0.6B and mDeBERTa multilingual NLI produced the [4,800 inference records](../evaluation/grading/results/inference.jsonl) on CPU in FP32. Model revisions, dataset hash and inference hash are recorded in the [calibration artifact](../evaluation/grading/results/calibration/calibration.json). The classifier uses concept coverage, minimum required-concept support, contradiction, alignment and neutrality. Calibration rejects partial output, canonical-input drift, version drift and overlapping families. See the [annotation guide](../evaluation/grading/ANNOTATION_GUIDE.md) for provisional label definitions.

The acceptance policy must meet both overall accepted-decision precision and precision among predicted-correct answers ≥95%, contradiction false-pass rate ≤2%, coverage ≥70%, and worst typo/clause-order macro-F1 degradation ≤0.05. Abstention is a runtime outcome outside the three supervised labels. Precision is undefined when no decisions are accepted; all-abstention cannot pass. These are point-estimate gates, not population guarantees.

## Frozen test results

| Hybrid policy | Accepted / total | Accepted precision | Predicted-correct precision | Contradiction passes | Worst noise F1 drop | Gate |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| English | 286 / 320 | 272/286 = 95.105% | 141/146 = 96.575% | 0/80 | 0.112751 | Failed: noise |
| Hindi | 0 / 320 | Undefined | Undefined | 0/80 | 0 under abstention | Failed: no qualifying development policy |
| Hinglish | 0 / 320 | Undefined | Undefined | 0/80 | 0 under abstention | Failed: no qualifying development policy |

Source: `ablations.hybrid.<language>.heldout` in [evaluation.json](../evaluation/grading/results/calibration/evaluation.json). English matched-baseline macro-F1 is 0.884872; replacing clean answers with clause-order variants lowers it to 0.772121. Framing typos caused no measured degradation in this fixture. Hindi's best development coverage meeting the precision and contradiction constraints was 36.5625%, below the 70% requirement; Hinglish had no qualifying operating point.

English accepted precision has a Wilson 95% interval of 91.952–97.062%; predicted-correct precision has 92.234–98.528%. The interval for 0/80 contradiction false passes extends to 4.582%. Zero observed passes therefore does not establish a population rate below 2%.

### Baseline comparison

Each feature ablation fits its own classifier and calibration on the same partitions. The following macro-F1 values use argmax predictions before abstention; they are separate from release-policy metrics.

| Features | English | Hindi | Hinglish |
| --- | ---: | ---: | ---: |
| Embedding only | 0.353670 | 0.386393 | 0.253912 |
| NLI only | 0.867770 | 0.881433 | 0.576487 |
| Hybrid | 0.859640 | 0.866622 | 0.588386 |

Source: `ablations.<variant>.<language>.heldout.unselective_macro_f1` in [evaluation.json](../evaluation/grading/results/calibration/evaluation.json). Hybrid features do not consistently outperform NLI alone. These ablations compare representations within this decision layer; they do not compare against human grading, commercial systems or real learner outcomes.

## Scheduling comparison

Synthetic scheduling results use seed 73, 60 cards, 3,000 hypothetical events and a declared 5% attention-lapse floor. The actual FSRS optimiser fits 960 eligible training outcomes. Candidate parameters are compared with default FSRS-6 parameters on later windows.

| Synthetic window | Outcomes | Default log loss | Candidate log loss | Default Brier | Candidate Brier |
| --- | ---: | ---: | ---: | ---: | ---: |
| Validation | 1,020 | 0.217930 | 0.194023 | 0.042862 | 0.042818 |
| Reporting | 960 | 0.266717 | 0.234112 | 0.055109 | 0.053863 |

The validation log-loss difference has a paired-by-card bootstrap interval of [−0.034499, −0.013699] from 1,000 seeded resamples. The reporting window is unused for activation. Its historical artifact contains `activate: true` from the earlier comparison helper invocation alongside `used_for_activation: false`; no parameters were activated and no events were inserted into a learner database. A fresh reporting-only run explicitly emits `status: reported`, `activate: false` and `used_for_activation: false`, with identical numeric metrics and outcome membership. The historical JSON reports have been removed; rerun the scheduler to generate fresh results. These broad synthetic windows differ from the production policy's reserved next-100-outcome reporting window. No real retention or workload improvement follows from this simulation.

## System and execution checks

The historical verification, platform, scheduling, migration, queue, OCR and API reports have been removed. Their measurements below are historical summaries; use the reproduction commands to generate fresh reports.

| Check | Recorded observation | Scope |
| --- | --- | --- |
| Migration rehearsal | Nine migrations; all 458 item IDs retained; integrity OK; no foreign-key violations | Copy of the preserved database; live database untouched |
| Queue recovery | Broker refusal, worker death after page checkpoint, replacement recovery and duplicate delivery passed | One real PDF page/candidate; fixture drafts |
| OCR compatibility | Two English sentences, character error rate 0, valid source boxes; 22.719 s | One rendered paragraph; startup and queue wait included |
| [Grading worker](../evaluation/grading/results/runtime-smoke.json) | First request 11.390 s; reused worker 0.644/0.322 s | Three clean constructed examples; gate bypass for execution only |
| API responsiveness | Snapshot median 4.55 ms, p95 11.06 ms | 40 sequential authenticated requests; two-item fixture; concurrency one |
| [Gate enforcement](../evaluation/grading/results/gate-enforcement.json) | Nine uncertain assessments, zero reviews and zero model/provider calls | Frozen failed artifact; temporary database; forced audio failures included |

Full [inference timing](../evaluation/grading/results/inference.summary.json) reports median 0.243 s and p95 0.673 s per example, with a 3.591 GB process RSS high-water mark. The final invocation resumed 702 records and computed 4,098; its 1,643.10 s wall time is not total experiment time. Reference embeddings were cached and measurements used a shared arm64 Mac. Sampled worker-process-tree RSS peaked at 2.576 GB. OCR's 2.243 GB sampled process RSS excludes separately accounted Metal allocations. Sampling can miss brief peaks and count shared pages more than once; these are distinct measurements, not total system memory or a controlled speed comparison.

Run the [reproduction commands](../evaluation/README.md), then read [failure analysis](failure-analysis.md) and [limitations](limitations.md) before interpreting the results.
