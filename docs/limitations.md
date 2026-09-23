# Limitations and open questions

RecallX is a personal local deployment with tested persistence and recovery mechanisms. Its experiments establish narrower claims than validated multilingual grading, real learner personalisation or production-scale service quality.

| Boundary | What the current evidence establishes | What remains unestablished |
| --- | --- | --- |
| Grading labels | Actual checkpoints evaluated on 4,800 constructed examples | Independent human agreement, learner-answer quality and translation validity |
| Automatic decisions | All three frozen language gates fail; service abstention is tested | A releasable semantic-grading policy |
| Language coverage | English references paired with English, Hindi and Roman-script Hinglish answers | Other reference languages, natural code switching and wider proficiency levels |
| Rubrics and noise | Two required concepts and eight template variants per family | Broad synonyms, variable-size rubrics, long explanations and realistic OCR/ASR corruption |
| Personalisation | Real optimiser runs on seeded hypothetical outcomes | Improved retention, fewer reviews or better prediction for an actual learner |
| OCR | One clean English paragraph recognized with real CPU/MLX pipelines | Representative scanned documents, handwriting, complex layouts and multilingual accuracy |
| Performance | Measurements on a shared arm64 Mac and a two-item API fixture | Controlled device comparisons, high concurrency, large libraries or service-level targets |
| Platforms | Browser checks and signed iPhone simulator behavior; Android configurations generated | Android phone/TV builds, physical-device behavior and broad accessibility coverage |

## Statistical and experimental limits

The grading split contains 40 held-out vocabulary families per language. Variants within a family are related, and Wilson intervals reported for decision counts do not model that dependence. English's 95.105% accepted precision is a point estimate with a 91.952–97.062% interval. Observing zero contradiction passes among 80 examples has an interval extending to 4.582%. Release gates use point estimates; the experiment cannot promise a population error bound.

Constructed labels are hypotheses rather than adjudicated ground truth. Framing typos are easier than corruption of meaning-bearing words. Dataset families and distractors are kept within their partitions, but the seeds and templates still define a narrow distribution. Test results must inform a new versioned development iteration, not threshold tuning against the already reported test partition.

The synthetic scheduler uses a declared latent parameter vector, fixed timing and a 5% lapse floor. Its candidate improves prediction on later simulated windows; those assumptions can favor learnable behavior. The production fitting policy requires at least 512 eligible training outcomes across 30 cards, including 20 successes and 20 failures; later validation adds diversity and duration requirements. The next 100 eligible outcomes after frozen validation are reserved for reporting. No measured learner history in this evidence pack supports a real-world gain.

## Operational limits

The server supports one learner with paired devices and a local SQLite database. It is designed for a private deployment, with the browser served from localhost or an explicitly configured HTTPS origin. Public internet deployment, multiple isolated tenants, distributed workers and production security auditing have no supporting evidence here.

Offline clients preserve cached data and pending operations; authoritative schedules depend on server acknowledgment. A server restored from an older backup cannot recover newer events unless clients still retain them. Original document assets require a data-directory backup in addition to SQLite or JSON export. Browser durability relies on IndexedDB, Web Locks and a secure context; device storage deletion removes that client's cached state.

Raw answers and original uploads remain local until deletion or configured expiry. A local deployment does not by itself establish encryption at rest, anonymity or a reviewed privacy policy. Configured generative providers can receive content used for drafting and teaching; semantic grading uses local discriminative models. Review the selected provider and backup storage before importing sensitive material.

Heavy model workloads share a lease to control local resource contention. OCR page startup and grader cold loading are material costs. Process RSS is not total unified-memory usage, and Metal allocations are excluded from the recorded OCR RSS. Model smoke results depend on the pinned runtime and hardware; the small fixture does not guarantee sustained ingestion throughput.

## Next evidence to collect

1. Independently annotate ordinary learner responses, translations, synonyms, ambiguous fragments and meaningful noise; adjudicate disagreements before changing quality claims.
2. Compare context-aware clause handling with the current contradiction aggregation on development data, then evaluate on new held-out families.
3. Collect clean real learner outcomes and use the frozen training, validation and reporting policy to measure prediction before claiming retention or workload gains.
4. Benchmark representative document pages with reviewed text and geometry, then measure cold/warm execution under controlled concurrency.
5. Complete Android phone/TV builds and physical-device workflows, including offline recovery and accessibility checks.

The [evaluation](evaluation.md) and [failure analysis](failure-analysis.md) link each existing observation to its artifacts. These open questions are future work, not completed results.
