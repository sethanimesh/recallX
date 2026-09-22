# ADR-0002: Approved rubrics and selective semantic assessment

**Status:** Accepted, implemented; quality gates currently fail for all evaluated languages.

**Documented:** 2026-09-28, retrospective.

## Context and drivers

Learners explain a meaning in their own words. A plausible paraphrase may omit a required qualifier or also contain a contradiction. A content generator's output cannot by itself establish correctness, and model outages must not become false forgetting events. References need human approval and revision tracking.

## Alternatives

| Option | Advantage | Limitation |
| --- | --- | --- |
| Exact text matching | Cheap and predictable | Rejects valid paraphrases and multilingual answers |
| Single cosine threshold | Small implementation | Similarity alone does not enforce required concepts or contradiction policy |
| Generative correctness judge | Flexible text feedback | Adds variable judgment and mixes teaching/content generation with scheduling authority |
| Approved concepts plus discriminative evidence and abstention | Inspectable concept evidence and explicit quality policy | Requires calibration and may accept few answers |

These are architectural alternatives; the recorded experiment evaluates the implemented model and its declared ablations, not every option above.

## Decision and rationale

The server loads the latest approved rubric for the requested content revision. Pinned Qwen3 embeddings align spans with concepts; pinned mDeBERTa NLI evaluates support and contradiction across all spans. A versioned five-feature scoring layer uses calibrated probabilities, language thresholds and a contradiction veto. Missing dependencies, drift and failed language gates return `uncertain`.

Generative providers may draft definitions, mnemonics and teaching content. They do not grade. Tutor and assisted answers remain practice. Only eligible scheduled assessments can reach the review policy, which obtains the decision from a canonical assessment ID rather than a client-supplied verdict.

## Evidence

- [Assessment service](../../backend/assessment/service.py), [models](../../backend/assessment/inference.py), [selective scoring](../../backend/assessment/scoring.py) and [review policy](../../backend/routers/reviews.py).
- [Assessment tests](../../backend/tests/test_assessment.py) cover absent rubrics, model failure, drift, contradiction, assistance and idempotency.
- [Actual-model report](../../evidence/grading-report.md): the frozen synthetic evaluation passes no language gate. The visible experimental setting cannot override it.

## Trade-offs and consequences

Abstention protects the schedule from unsupported judgments but reduces usable semantic-review coverage. Current semantic assessments remain uncertain; self-rated flashcards provide the functioning scheduling path. Required concepts still depend on the quality of human-approved rubrics. Constructed labels cannot establish real-learner or broad multilingual validity.

## Revisit conditions

Reconsider model/scoring choices after independently annotated learner data exposes persistent errors, or after a prospective evaluation supports a better operating point under the same declared precision, contradiction and noise policy.
