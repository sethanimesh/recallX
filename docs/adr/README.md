# Architecture decision records

These records describe consequential choices visible in the current code. All were documented retrospectively on **28 September 2026**. Their numbers provide a reading order, not an original decision chronology. `Accepted` means the choice is implemented; it does not mean its alternatives were experimentally compared or its model quality passed release gates.

| Record | Implemented choice | Main trade-off |
| --- | --- | --- |
| [0001 — Central review authority](0001-central-review-authority.md) | Server review journal and FSRS; durable pending clients | Offline attempts wait for authoritative scheduling |
| [0002 — Selective semantic assessment](0002-selective-semantic-assessment.md) | Approved rubrics, discriminative evidence and abstention gates | Coverage depends on calibrated quality; current language gates fail |
| [0003 — Durable ingestion jobs](0003-durable-ingestion-jobs.md) | SQLite outbox, checkpoints, leases and human acceptance | More persisted state and recovery logic |
| [0004 — Isolated local inference](0004-isolated-local-inference.md) | Separate native environments and shared model-residency lease | Cold starts and serialized heavyweight work |

Rationale is inferred from implemented constraints where no contemporaneous decision record exists. Alternatives are engineering comparisons documented here, not claims about experiments previously performed. Each record links to its implementation and evidence.
