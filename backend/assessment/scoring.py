"""Versioned feature extraction and calibrated selective decisions; no guessed cosine pass cutoff."""
import json
import math
import os
from pathlib import Path

SCORER_VERSION = 'hybrid-concept-v1'
FEATURE_NAMES = ['coverage', 'required_min', 'contradiction', 'alignment', 'neutrality']
LABELS = ['incorrect', 'partial', 'correct']


def features(results):
    if any(not math.isfinite(float(r[key])) for r in results for key in ('weight','support','contradiction','alignment','neutrality')):
        raise ValueError('Non-finite model evidence')
    required = [r for r in results if r['required']]
    total = sum(r['weight'] for r in required)
    if not required or total <= 0:
        raise ValueError('No required concepts')
    return [
        sum(r['weight'] * r['support'] for r in required) / total,
        min(r['support'] for r in required),
        max(r['contradiction'] for r in results),
        sum(r['weight'] * r['alignment'] for r in required) / total,
        sum(r['weight'] * r['neutrality'] for r in required) / total,
    ]


def probabilities(values, artifact):
    logits = [b + sum(w*x for w,x in zip(ws,values)) for b,ws in zip(artifact['intercepts'],artifact['coefficients'])]
    temperature = artifact['temperature']
    logits = [v/temperature for v in logits]
    pivot = max(logits)
    exps = [math.exp(v-pivot) for v in logits]
    return [v/sum(exps) for v in exps]


def decide_probabilities(probs, values, thresholds, contradiction_veto):
    """The exact policy used for both development/test metrics and live decisions."""
    if not all(math.isfinite(x) for x in probs+values):
        return 'uncertain', None, 'model_unavailable'
    if values[2] >= contradiction_veto:
        if probs[0] >= thresholds.get('incorrect',1.0):
            return 'incorrect',probs[0],'contradiction'
        return 'uncertain',max(probs),'contradiction_unresolved'
    index=max(range(3),key=probs.__getitem__)
    label=LABELS[index]
    if probs[index]<thresholds.get(label,1.0):
        return 'uncertain',probs[index],'low_confidence'
    return label,probs[index],'calibrated'


def load_artifact(path, versions):
    if not path or not Path(path).is_file():
        return None
    try:
        artifact = json.loads(Path(path).read_text())
        if artifact['schema_version'] != 1 or artifact['scorer_version'] != SCORER_VERSION:
            return None
        if artifact['feature_names'] != FEATURE_NAMES or artifact['labels'] != LABELS:
            return None
        if any(artifact['model_versions'].get(k) != v for k,v in versions.items()):
            return None
        if artifact.get('inference_device','cpu') != os.getenv('RECALLX_GRADING_DEVICE','cpu'):
            return None
        if len(artifact['coefficients']) != 3 or len(artifact['intercepts']) != 3:
            return None
        if any(len(ws) != 5 for ws in artifact['coefficients']):
            return None
        numbers = artifact['intercepts'] + [x for row in artifact['coefficients'] for x in row] + [artifact['temperature']]
        if not all(math.isfinite(x) for x in numbers) or artifact['temperature'] <= 0:
            return None
        for language,gate in artifact.get('release_gates',{}).items():
            if not isinstance(gate.get('passed'),bool):
                return None
            thresholds=artifact.get('thresholds',{}).get(language,{})
            veto=artifact.get('contradiction_veto',{}).get(language)
            if gate['passed'] and (set(thresholds)!=set(LABELS) or veto is None):
                return None
            values=list(thresholds.values())+([veto] if veto is not None else [])
            if any(not math.isfinite(value) or not 0<=value<=1 for value in values):
                return None
        return artifact
    except (KeyError, ValueError, TypeError, AttributeError, OverflowError, OSError):
        return None


def selective_decision(values, artifact, language):
    """Only language slices passing fixed heldout gates may produce a decision."""
    if not artifact or not artifact.get('release_gates', {}).get(language, {}).get('passed', False):
        return 'uncertain', None, 'calibration_unavailable'
    thresholds = artifact.get('thresholds', {}).get(language)
    if not thresholds:
        return 'uncertain', None, 'unsupported_language'
    veto=artifact.get('contradiction_veto',{}).get(language)
    if veto is None:
        return 'uncertain',None,'calibration_unavailable'
    return decide_probabilities(probabilities(values,artifact),values,thresholds,veto)


def feedback(decision, results, reason):
    if decision == 'uncertain':
        messages = {
            'empty_answer': 'Enter an explanation of the word before submitting.',
            'hint_request': 'Try explaining the meaning in your own words. You can reveal the reference for practice.',
            'rubric_not_approved': 'This meaning needs an approved concept rubric before it can be assessed.',
            'experimental_disabled': 'Experimental assessment is off. You can continue with self-rated flashcards.',
            'model_unavailable': 'Assessment is temporarily unavailable. Your answer was saved; this is not a failed recall.',
            'input_too_long': 'Please shorten the answer. The complete response could not be assessed within the input limit.',
            'unsupported_language': 'Assessment is not enabled for this language. Use English, Hindi, or Hinglish.',
            'unsupported_language_pair': 'This reference and answer language pair has no validated experimental calibration yet.',
            'calibration_unavailable': 'No validated experimental calibration is available for this language yet.',
            'assisted': 'This answer followed assistance and is saved as practice.',
        }
        return messages.get(reason, 'The evidence is inconclusive. Please clarify the meaning in your own words.')
    if decision == 'correct':
        return 'Your explanation covers the required meaning.'
    ordered = sorted(results, key=lambda r: r['support'])
    if decision == 'incorrect' and reason == 'contradiction':
        conflict = max(results, key=lambda r: r['contradiction'])
        if conflict.get('contradiction_span'):
            return f'The answer conflicts with this concept: {conflict["text"]}'
    return 'Please clarify this part of the meaning: ' + ordered[0]['text']
