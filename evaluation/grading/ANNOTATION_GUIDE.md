# Experimental annotation guide

This first dataset uses construction hypotheses approved for experimental work because no independent human annotator is available. None of the labels is adjudicated ground truth. The examples and translations need review before claims about learner-quality grading are made.

The intended answer labels are:

| Label | Meaning | Example for “abundant,” requiring availability and a large quantity |
| --- | --- | --- |
| correct | Expresses every required concept without a conflicting claim. Grammar variation is allowed. | “It is available in large quantities.” |
| partial | Expresses some required meaning and omits a necessary qualifier. | “It is available.” |
| incorrect | Rejects the target meaning, explains another meaning, or combines a correct explanation with a contradictory assertion. | “There is a large supply, but only a very small amount is available.” |
| uncertain | The system lacks sufficient calibrated evidence, a required concept is ambiguous, or the input cannot be assessed completely. This is a selective runtime decision, not a fourth supervised class. | “It is enough.” |

Empty answers and explicit requests for help do not enter the classifier and are not failed recalls. Assisted and tutor answers can receive feedback, but retain their practice flags and do not update a memory schedule.

Concept labels describe support, neutrality/missing evidence, or contradiction. Neutral does not mean false. A response can support a concept in one span and contradict it in another; contradiction is preserved separately. The generated concept labels for a negated composite definition are provisional because the scope of negation can be ambiguous.

The eight generated variants are a full explanation, a framing paraphrase, a framing typo, swapped clause order, a core-only partial explanation, a negation, an unrelated definition and a mixed supporting/contradictory answer. English canonical concepts are shared across English, Hindi and Roman-script Hinglish answers. These variations do not exhaust natural paraphrases, accepted synonyms, code switching, grammar errors, negation scope or OCR/ASR corruption. In particular, a misspelled framing word is an easier test than corruption of a meaning-bearing word.

Every family and its variants belong to exactly one split. Unrelated distractors are selected from that same split, so training text cannot expose held-out definition content. Only training labels fit the classifier, calibration labels fit temperature, development labels select the operating policy, and untouched test labels determine the experimental release gate. Correctness precision and overall accepted-decision precision must both pass; all-abstention is a gate failure, not success.

Future annotation should include independent labels for ordinary learner responses and a reviewed subset with adjudicated disagreements. Add synonyms, fragments, ambiguous cases and realistic noise before broadening the supported distribution. Changing labels, features, model revisions, device or policy requires a new versioned evaluation; never tune the policy against the reported test set.
