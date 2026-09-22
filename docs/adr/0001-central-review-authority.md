# ADR-0001: Central review authority with durable clients

**Status:** Accepted, implemented.

**Documented:** 2026-09-28, retrospective.

## Context and drivers

One learner reviews the same vocabulary on multiple devices, including disconnected clients. Retries must not duplicate a review, and a delayed attempt must not silently restore reset progress or apply an obsolete meaning. Due dates depend on the complete ordered history and the scheduling configuration used by each attempt.

## Alternatives

| Option | Advantage | Cost under these constraints |
| --- | --- | --- |
| Device-owned schedules with last-write-wins sync | Immediate local scheduling | Concurrent state writes can discard valid attempts or overwrite newer state |
| Online-only server reviews | Small client state model | Disconnection loses usable review capture |
| Central review journal with durable pending clients | One replay policy and recoverable attempts | Scheduling confirmation waits for the API |

These alternatives were not benchmarked. The table explains design consequences.

## Decision and rationale

The API owns immutable review facts, UUID receipts and separate recall/flashcard FSRS states. Clients transactionally save a UUID, device sequence and displayed content/settings context before sending. Offline self-ratings remain pending; typed answers remain drafts. Accepted attempts replay chronologically through Python FSRS 6.3.2 with fuzzing disabled.

This permits a lost response to be retried without a second transition. Different attempts remain distinct even when they were answered against the same state version. Generation and content checks keep stale attempts as practice, while corrections append audit records and rebuild affected state.

## Evidence

- [Review policy](../../backend/routers/reviews.py), [FSRS replay](../../backend/services/scheduling.py) and [client queue](../../src/db/operations/central.ts).
- [Central review tests](../../backend/tests/test_central_reviews.py) cover duplicate acknowledgements, out-of-order reviews, concurrent attempts, reset generations, corrections and recorded configuration.
- [Client queue tests](../../src/db/operations/__tests__/central.test.ts) cover persistence and acknowledgement behavior.

## Trade-offs and consequences

The design gains inspectable history and deterministic retry semantics. It sacrifices an immediately confirmed offline due date and introduces versioned operation state on each client. Server availability, backups and client clock plausibility remain operational concerns. SQLite is appropriate to this personal single-server topology; multi-server writes would require a different coordination design.

## Revisit conditions

Reconsider if autonomous offline scheduling becomes a requirement, the deployment becomes multi-tenant/multi-server, or measured replay and write contention exceed the local workload's needs.
