# ADR-0004: Isolated local inference with shared memory coordination

**Status:** Accepted, implemented for the personal Mac runtime.

**Documented:** 2026-09-28, retrospective.

## Context and drivers

The API, PyTorch grading, PaddleOCR and MLX recognition depend on different native stacks. Several resident models can compete for the Mac's finite unified memory. A background OCR page should not indefinitely block interactive grading, and terminated parents must not leave unrestricted model processes behind.

## Alternatives

| Option | Advantage | Limitation |
| --- | --- | --- |
| One environment with permanently resident models | Warm inference | Couples native dependencies and concurrent memory demand |
| Independent model services without coordination | Separate dependencies | Services may still load competing models simultaneously |
| Separate environments with a shared inference lease | Explicit interpreter boundaries and serialized residency | Cold starts and waiting for the current task |

This is a constraint-based comparison, not a measured latency comparison of all designs.

## Decision and rationale

Keep API, grading, OCR and MLX dependencies in separate pinned environments. Heavy local model use shares a file lease under the data directory. The grading worker holds it while models remain resident and retires after eight requests or a 15-second idle wait. Background pages yield to waiting grading requests between pages.

Each default MLX OCR page owns a loopback recognition service and terminates it before releasing the shared lease. The pipeline retains CPU layout and reading order. Local generation and optimisation also coordinate model residency; bounded process deadlines provide additional protection after parent death. Full CPU OCR remains an explicit diagnostic path rather than an automatic fallback.

## Evidence

- [Shared lease](../../backend/local_runtime.py), [grading worker](../../backend/assessment/worker.py), [OCR parser](../../backend/ingestion/parser.py) and [owned MLX service](../../backend/ingestion/mlx_service.py).
- [Lease priority tests](../../backend/tests/test_inference_lease.py), [service teardown tests](../../backend/tests/test_mlx_service.py) and [optimiser process checks](../../backend/tests/test_optimization_policy.py).
- [Real MLX smoke](../../evidence/ocr/smoke-mlx.json) establishes execution for two known sentences. Sampled process RSS excludes separately accounted Metal allocations and is not total unified-memory use.

## Trade-offs and consequences

Isolation makes dependency and process ownership explicit, but heavyweight work is serialized. Grading priority applies between background tasks; it does not preempt a running OCR page. Cold model startup remains visible latency, and sustained grading can delay background work. File locks, signals and the owned Mac services make this a single-host native design, not a portable distributed deployment.

## Revisit conditions

Reconsider when measured queue delays become unacceptable, hardware supports safe concurrent residency, or deployment moves to dedicated model hosts with a scheduler that can enforce resource limits directly.
