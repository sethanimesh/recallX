# Experimental grading evaluation

These 200 project-authored vocabulary families produce 4,800 constructed answers (eight variants in English, Hindi and Hinglish). The labels are **synthetic hypotheses**, not human annotations or established learner-quality evidence. Hindi/Hinglish phrasing and partial-answer labels may need correction. The source definitions deliberately contain a core meaning and a qualifying concept.

All variants of each family stay together in the deterministic 40/20/20/20 train/development/calibration/test split. The manifest hashes the exact generated dataset. No model-produced judgments supply labels. The calibrator refuses partial, duplicate, relabelled, mixed-version or overlapping-family output. Contradictory mixed answers preserve every span in NLI aggregation.

All reference concepts are English. The measured pairs are English-reference → English, Hindi and Hinglish answers. Other reference-language pairs abstain until separately calibrated. The fixed two-concept vocabulary rubrics and template variations are narrower than real learner responses; one-word synonyms, longer answers, variable-size rubrics and real OCR/ASR noise need separately reviewed data. See [the annotation guide](ANNOTATION_GUIDE.md).

Use the isolated Python 3.11 grading environment. From the repository root:

```sh
backend/.venv-grading/bin/python evaluation/grading/build_dataset.py
backend/.venv-grading/bin/python evaluation/grading/download_models.py
backend/.venv-grading/bin/python evaluation/grading/run_inference.py --output evaluation/grading/results/smoke.jsonl --limit 24
backend/.venv-grading/bin/python evaluation/grading/run_inference.py --output evaluation/grading/results/inference.jsonl
backend/.venv-grading/bin/python evaluation/grading/calibrate.py --inference evaluation/grading/results/inference.jsonl --output evaluation/grading/results/calibration
```

The 24-example smoke is one family across all three languages and eight perturbations; it cannot establish accuracy or fit calibration. Full inference resumes by ID after interruption and never substitutes mocked outputs. Run it as a low-priority maintenance job: it holds the shared heavy-model lease, so interactive grading and OCR wait until it exits.

The decision layer is multinomial logistic regression fitted only on training features. Scalar temperature is fitted only on the calibration partition; per-language acceptance and contradiction-veto thresholds are selected only on development data. The same policy function is evaluated and served: strong contradiction cannot be outweighed by a correct-span logit; it yields a confident incorrect decision or abstention. The untouched test partition decides whether that language can be enabled: precision among predicted-correct answers and overall accepted-decision precision ≥.95, contradiction false-pass ≤.02, automatic coverage ≥.70 and worst typo/word-order macro-F1 degradation ≤.05. A slice with no predicted-correct answers cannot pass. Reports include Wilson 95% intervals, embedding-only, NLI-only and hybrid ablations, counts, false accepts/rejects, Brier score, calibration bins, concept/coverage measurements, paired perturbations and risk/coverage. These gates use point estimates; the reported confidence intervals describe sampling uncertainty and do not establish a population guarantee. Failure retains abstention.

Set `RECALLX_CALIBRATION_PATH` only to the generated calibration file and explicitly enable experimental assessment in learner settings. The default configuration has no active calibration. An approved canonical rubric and matching content/model/scorer revisions are also required. Set `RECALLX_GRADING_PYTHON` to the isolated environment's absolute interpreter path. Checkpoints are pinned in `backend/assessment/inference.py`; their default cache is `models/huggingface` and normal inference is strictly local. CPU FP32 is the baseline. MPS is an opt-in experimental device requiring separate smoke/parity measurements; no performance claim follows from its presence.

Raw responses are retained until explicit deletion by default. An optional `RECALLX_RAW_ANSWER_RETENTION_DAYS` enables expiry, checked when assessments are accessed; deleting raw data also removes verbatim evidence spans while retaining numeric concept evidence, model versions and immutable review facts. Reviews created from experimental assessments must remain excluded from personal FSRS fitting.

The frozen release artifact currently fails all three language gates. Reproduce the HTTP gate check using the light API environment:

```sh
backend/.venv/bin/python evaluation/grading/verify_gates.py
```

This check creates an isolated temporary database, enables experimental grading, approves a canonical rubric, and invokes the assessment and both tutor endpoints in every supported language. It blanks generative-provider credentials before imports and prohibits provider construction, chat-completion calls, and model inference. All nine assessment attempts must abstain and remain durable, including three forced speech failures; zero reviews may be written. It verifies enforcement of the frozen failed artifact, separately from the genuine model execution measurements below.

For deployment profiling, run the actual async service and its worker from the light API environment. The first of three requests includes worker creation/model loading; two following requests measure reuse. The model worker exits before results are written. This check bypasses decision gates only to inspect raw model evidence; it never changes settings, writes reviews or asserts answer quality.

```sh
backend/.venv/bin/python evaluation/grading/profile_command.py --output evaluation/grading/results/runtime-process-tree.json -- backend/.venv/bin/python evaluation/grading/runtime_smoke.py --output evaluation/grading/results/runtime-smoke.json
```

The profiler sums resident memory over recursive descendants every 0.2 seconds using `ps`; shared pages can be counted twice and brief peaks can be missed. The smoke also records the OS worker RSS high-water mark and worker user/system CPU seconds. Report both measurements and the sampling method instead of presenting a single-process estimate as full-system RAM. The complete inference runner records per-answer wall times separately from cold loading; resumptions and reference-cache hits must be disclosed when comparing timings.
