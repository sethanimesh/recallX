# Methodology

Documented 28 September 2026. This is the engineering and evaluation method reflected in the current repository, not a claim that this document existed during earlier development.

## Problem and constraints

RecallX connects vocabulary captured from documents with later review across personal devices. The difficult part is preserving one trustworthy learning history while clients disconnect, retry requests, edit meanings or submit attempts out of order. Typed explanations add another constraint: semantic similarity can reward an answer that also contradicts the meaning, and an unavailable model must not be treated as forgetting. Document imports add long-running native workloads, uncertain extraction quality and source geometry that must survive human correction.

The current scope is a single learner on a local Mac with phone, browser and TV clients. Finite memory and conflicting native dependencies constrain inference. The implementation uses durable transactions, versioned content, explicit acknowledgements, selective assessment and human approval to address those constraints.

## Starting point and comparisons

The starting revision was `6ea2f3e`, with existing local TV/navigation changes. The historical baseline report has been removed; it was not a learner study or model benchmark.

| Question | Comparison or criterion | What it can establish |
| --- | --- | --- |
| Can a review survive retry and concurrent devices? | One receipt for a replayed UUID; chronological replay for distinct attempts | Storage and scheduling invariants under the tested scenarios |
| Does each grading mechanism help? | Frozen full model versus declared ablations on the same family split | Differences within the constructed assessment workload |
| Does a fitted schedule predict later recall better? | Pinned default FSRS versus fitted parameters on later outcomes | Predictive log-loss/Brier differences in that dataset |
| Does local OCR execute correctly? | Known source text and geometry in a real checkpoint smoke | Compatibility for that small fixture |
| Can ingestion recover? | Broker refusal, worker termination, replacement and duplicate delivery | Durable recovery for the controlled queue workload |

Possible architectural alternatives are recorded in [ADRs](adr/README.md). They were not all implemented or benchmarked; their trade-offs describe consequences of the current design.

## Build evidence from invariants

The implementation is evaluated through boundaries where a failure would corrupt history: persistence before network I/O, review and receipt in one server transaction, server-owned due dates, version checks before grading and committing, lease checks before ingestion writes, and atomic item acceptance. Controlled tests exercise these behaviors with isolated databases and fixed fixtures. A [cross-service learning journey](../backend/tests/test_learning_journey.py) connects upload, provenance, human acceptance, rubric approval, assessment gating, self-rating, retry and a second paired device.

Real-runtime checks are separate: pinned model execution, native OCR, actual Redis/Celery recovery and recorded browser/native checks. Test doubles establish control flow; they do not establish provider or model quality. Build success establishes build compatibility; it does not establish every device interaction.

## Semantic assessment protocol

The [grading dataset](../evaluation/grading/README.md) contains 4,800 constructed examples from 200 families, eight answer types and three languages. A family and all its translated/perturbed variants remain in one fixed partition: 40% training, 20% development, 20% calibration and 20% test. This guards against closely related variants crossing the split.

The training partition fits the decision layer; development selects operating thresholds; calibration fits probability temperature; untouched test families determine language release gates. Checkpoint revisions, inference device, feature names and scorer version are part of the artifact contract. The pipeline rejects partial inference and drift. It reports precision among accepted answers, accepted coverage, contradiction passes, noise degradation and calibration, with declared ablations.

The labels are synthetic hypotheses. Neither label provenance nor the family split makes them independently reviewed ground truth. The current recorded run enables no language; failed gates remain failed even when experimental grading is selected. See [evaluation](evaluation.md), [failure analysis](failure-analysis.md) and the raw grading report for results and limits.

## Scheduling protocol

Personal fitting includes acknowledged, eligible later-day history, separates recall from flashcards and excludes experimental, assisted, corrected or untrusted sequences. Content revisions and progress generations define separate fitting sequences. The policy requires at least 512 eligible outcomes across 30 cards and 20 successes and 20 failures before fitting.

A candidate is compared with its baseline on subsequent outcomes, with at least 100 validation outcomes over 14 days, 20 cards and ten outcomes of each rating class. Activation requires at least 1% lower log loss, no worse Brier score and a negative upper bound in a paired-by-card bootstrap interval. A further 100 outcomes are reserved for reporting and cannot control activation. Late arrivals or corrections invalidate affected frozen evidence.

The [synthetic scheduling script](../backend/scripts/synthetic_scheduler.py) uses an isolated seeded workload and the actual pinned optimiser to demonstrate this pipeline. It inserts no simulated reviews into the learner database. Its improved prediction scores do not demonstrate improved retention or reduced review burden in a real learner.

## Reproducibility and interpretation

Use the [setup guide](setup.md) for pinned environment setup and commands, [evaluation guide](../evaluation/README.md) for experiment entry points for reproduction commands. Source assets, data partitions, model revisions and relevant runtime settings belong with their results. Re-run experiments into a separate output directory so retained evidence remains inspectable.

Evidence supports claims at different levels: code describes implemented mechanisms; controlled tests check invariants; runtime smoke checks compatibility; constructed workloads measure behavior on those examples; prospective learner outcomes would support personalisation claims. The repository currently contains the first four forms. General multilingual robustness, broad OCR quality and real learning benefit remain open evaluation questions.
