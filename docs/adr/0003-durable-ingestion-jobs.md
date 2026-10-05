# ADR-0003: Durable, checkpointed document ingestion

**Status:** Accepted, implemented.

**Documented:** 2026-09-28, retrospective.

## Context and drivers

PDF parsing, OCR and content drafting can outlive an HTTP request. Broker restarts and worker death must not lose the uploaded source. Users need source previews, corrections and resumable candidate decisions. Repeated deliveries and delayed controls must not duplicate accepted vocabulary or overwrite newer edits.

## Alternatives

| Option | Advantage | Limitation |
| --- | --- | --- |
| Process the whole upload in the request | Simple execution path | Long requests and no independent restart recovery |
| Store work only in the broker | Convenient asynchronous dispatch | Broker failure separates accepted upload state from queued work |
| Persist assets/jobs plus a database outbox and checkpoints | Recover from database state and resume completed stages | More tables, revision checks and recovery code |

These alternatives were not performance benchmarks.

## Decision and rationale

Persist actual bytes and source hashes alongside a SQLite job and outbox record. Celery messages carry job IDs. The API recovery loop and periodic dispatcher recover queued work after broker refusal or expired worker leases. Page and chunk checkpoints commit atomically, and a lease token fences later writes by stale workers.

Use native PDF text where suitable; otherwise run full layout/OCR. Preserve original/crop relationships, page geometry and passage citations. Draft generation remains editable. Human acceptance atomically creates/reuses an item sense, links sources, creates an unapproved rubric and initializes both scheduling modes. UUID receipts and explicit control/draft revisions protect retries and newer edits.

## Evidence

- [Dispatch](../../backend/ingestion/dispatch.py), [worker](../../backend/ingestion/worker.py), [parser](../../backend/ingestion/parser.py) and [acceptance service](../../backend/ingestion/service.py).
- [Ingestion tests](../../backend/tests/test_ingestion.py) cover checkpoints, stale leases, cancellation, source corrections, revision conflicts and atomic acceptance.
- Real Redis/Celery recovery uses actual PDF bytes and controlled drafting; it establishes the tested recovery behavior, not extraction quality.

## Trade-offs and consequences

The design gains resumability and source inspection at the cost of durable intermediate state and explicit cleanup/backup needs. Database and assets must remain consistent. Cancellation prevents later commits but cannot instantly interrupt every active page subprocess. Passage citations must not be presented as exact word alignments. General-document and vocabulary-MCQ modes remain explicit because their extraction instructions differ.

## Revisit conditions

Reconsider storage and dispatch when concurrent imports exceed the single-host workload, source retention demands object storage, or measured queue delay requires multiple independent inference workers.
