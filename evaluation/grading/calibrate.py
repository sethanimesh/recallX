"""Train, calibrate and evaluate on disjoint family partitions; never tunes on test data."""
import argparse
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'backend'))
from assessment.inference import MODEL_VERSIONS
from assessment.scoring import FEATURE_NAMES,LABELS,SCORER_VERSION,decide_probabilities

GATES={'accepted_precision_min':.95,'contradiction_false_pass_max':.02,'coverage_min':.70,'noisy_macro_f1_degradation_max':.05}


def feature_matrix(rows,ablation):
    import numpy as np
    matrix=np.array([row['features'] for row in rows],dtype=float)
    if ablation=='embedding_only':
        matrix[:,[0,1,2,4]]=0
    elif ablation=='nli_only':
        for i,row in enumerate(rows):
            required=[r for r in row['concept_results'] if r['required']]
            total=sum(r['weight'] for r in required)
            matrix[i,0]=sum(r['weight']*r['entailment'] for r in required)/total
            matrix[i,1]=min(r['entailment'] for r in required)
        matrix[:,3]=0
    return matrix


def softmax(logits,temperature=1):
    import numpy as np
    values=logits/temperature
    values-=values.max(axis=1,keepdims=True)
    exps=np.exp(values)
    return exps/exps.sum(axis=1,keepdims=True)


def wilson(successes,total):
    if not total: return None
    z=1.959963984540054
    p=successes/total
    denominator=1+z*z/total
    center=(p+z*z/(2*total))/denominator
    spread=z*((p*(1-p)/total+z*z/(4*total*total))**.5)/denominator
    return [max(0,center-spread),min(1,center+spread)]


def policy_predictions(rows,probabilities,threshold,veto):
    import numpy as np
    result=[]
    for row,p in zip(rows,probabilities):
        decision,_,_=decide_probabilities(list(p),row['features'],{label:threshold for label in LABELS},veto)
        result.append(LABELS.index(decision) if decision in LABELS else -1)
    return np.array(result)


def metrics(rows,probabilities,threshold=0,veto=1.01):
    import numpy as np
    from sklearn.metrics import f1_score
    labels=np.array([LABELS.index(r['label']) for r in rows])
    prediction=probabilities.argmax(axis=1)
    confidence=probabilities.max(axis=1)
    decisions=policy_predictions(rows,probabilities,threshold,veto)
    accepted=decisions>=0
    correct_accepted=decisions==2
    contradiction=np.array([r['perturbation'] in ('negation','mixed') for r in rows])
    negatives=labels!=LABELS.index('correct')
    positives=~negatives
    count=int(accepted.sum())
    correct_count=int(correct_accepted.sum())
    correct_successes=int((correct_accepted&(labels==2)).sum())
    bins=[]
    ece=0
    for lower in np.linspace(0,.9,10):
        selected=(confidence>=lower)&(confidence<(lower+.1) if lower<.9 else confidence<=1)
        if selected.any():
            accuracy=float((prediction[selected]==labels[selected]).mean())
            calibrated=float(confidence[selected].mean())
            ece+=float(selected.mean())*abs(accuracy-calibrated)
            bins.append({'lower':float(lower),'count':int(selected.sum()),'accuracy':accuracy,'confidence':calibrated})
    return {'count':len(rows),'accepted_count':count,'coverage':float(accepted.mean()),
            'accepted_precision':float((decisions[accepted]==labels[accepted]).mean()) if count else None,
            'accepted_precision_ci95':wilson(int((decisions[accepted]==labels[accepted]).sum()),count),
            'correct_accept_count':correct_count,'correct_accept_precision':correct_successes/correct_count if correct_count else None,
            'correct_accept_precision_ci95':wilson(correct_successes,correct_count),
            'macro_f1':float(f1_score(labels,decisions,labels=[0,1,2],average='macro',zero_division=0)),
            'unselective_macro_f1':float(f1_score(labels,prediction,labels=[0,1,2],average='macro',zero_division=0)),
            'contradiction_count':int(contradiction.sum()),
            'contradiction_false_pass':float((correct_accepted&contradiction).sum()/max(1,contradiction.sum())),
            'contradiction_false_pass_ci95':wilson(int((correct_accepted&contradiction).sum()),int(contradiction.sum())),
            'false_accept_rate':float((correct_accepted&negatives).sum()/max(1,negatives.sum())),
            'false_reject_rate':float(((decisions!=2)&accepted&positives).sum()/max(1,positives.sum())),
            'brier_score':float(((probabilities-np.eye(3)[labels])**2).sum(axis=1).mean()),
            'calibration_error':ece,'calibration_bins':bins,
            'risk':float((decisions[accepted]!=labels[accepted]).mean()) if count else None}


def choose_threshold(rows,probabilities):
    import numpy as np
    # Both thresholds are selected on development only. Failure forces abstention.
    best=None
    best_safe_coverage=0.0
    best_precision_at_required_coverage=None
    for veto in (.5,.6,.7,.8,.9,.95,.98):
        for threshold in np.linspace(.34,.99,66):
            result=metrics(rows,probabilities,float(threshold),veto)
            precision=result['accepted_precision']
            if result['coverage']>=GATES['coverage_min'] and precision is not None:
                best_precision_at_required_coverage=max(best_precision_at_required_coverage or 0,precision)
            safe=(result['accepted_precision'] is not None and result['accepted_precision']>=GATES['accepted_precision_min']
                and result['correct_accept_precision'] is not None and result['correct_accept_precision']>=GATES['accepted_precision_min']
                and result['contradiction_false_pass']<=GATES['contradiction_false_pass_max'])
            if safe:
                best_safe_coverage=max(best_safe_coverage,result['coverage'])
            if safe and result['coverage']>=GATES['coverage_min']:
                candidate=(result['coverage'],result['correct_accept_precision'],-veto,-float(threshold))
                if best is None or candidate>best[0]: best=(candidate,float(threshold),veto)
    diagnostics={'best_coverage_meeting_precision_and_contradiction_limits':best_safe_coverage,
                 'best_accepted_precision_at_required_coverage':best_precision_at_required_coverage,
                 'note':'Development-only grid diagnostics; no acceptable operating point forces abstention.'}
    return (*((best[1],best[2],True) if best else (1.0,.5,False)),diagnostics)


def concept_metrics(rows):
    import numpy as np
    from sklearn.metrics import f1_score
    truth=[];predicted=[];coverage_errors=[]
    names=['support','neutral','contradiction']
    for row in rows:
        expected=0;total=0
        for concept in row['concept_results']:
            target=row['concept_labels'][concept['concept_id']]
            truth.append(names.index(target))
            predicted.append(int(np.argmax([concept['entailment'],concept['neutrality'],concept['contradiction']])))
            if concept['required']:
                total+=concept['weight'];expected+=concept['weight']*(target=='support')
        coverage_errors.append(abs(row['features'][0]-expected/total))
    return {'concept_count':len(truth),'concept_macro_f1':float(f1_score(truth,predicted,labels=[0,1,2],average='macro',zero_division=0)),
            'soft_coverage_mae':float(np.mean(coverage_errors)),
            'note':'Concept labels are construction hypotheses; aggregated support is not a calibrated probability.'}


def paired_metrics(rows,probabilities,threshold,veto):
    import numpy as np
    by={(row['family_id'],row['perturbation']):i for i,row in enumerate(rows)}
    decision=policy_predictions(rows,probabilities,threshold,veto)
    result={}
    for kind in ('paraphrase','typo','word_order','negation','mixed'):
        pairs=[(i,by[(family,kind)]) for (family,perturbation),i in by.items() if perturbation=='clean']
        result[kind]={'pair_count':len(pairs),'decision_consistency':float(np.mean([decision[a]==decision[b] for a,b in pairs])),
                      'mean_absolute_coverage_change':float(np.mean([abs(rows[a]['features'][0]-rows[b]['features'][0]) for a,b in pairs])),
                      'correct_to_incorrect_rate':float(np.mean([decision[a]==2 and decision[b]==0 for a,b in pairs]))}
    return result


def evaluate_variant(partitions,ablation):
    import numpy as np
    from scipy.optimize import minimize_scalar
    from sklearn.linear_model import LogisticRegression
    train=partitions['train'];calibration=partitions['calibration']
    classifier=LogisticRegression(C=1,max_iter=2000,random_state=20260928)
    classifier.fit(feature_matrix(train,ablation),[LABELS.index(row['label']) for row in train])
    logits=classifier.decision_function(feature_matrix(calibration,ablation))
    truth=np.array([LABELS.index(row['label']) for row in calibration])
    def objective(log_temperature):
        p=softmax(logits,float(np.exp(log_temperature)))
        return float(-np.log(np.clip(p[np.arange(len(truth)),truth],1e-9,1)).mean())
    fit=minimize_scalar(objective,bounds=(-3,3),method='bounded')
    if not fit.success: raise RuntimeError('Temperature calibration did not converge')
    temperature=float(np.exp(fit.x))
    report={};thresholds={};release={};vetoes={}
    for language in ('en','hi','hi-Latn'):
        dev=[r for r in partitions['development'] if r['language']==language]
        test=[r for r in partitions['test'] if r['language']==language]
        if ablation=='embedding_only':
            # A pure embedding ablation must not receive NLI contradiction evidence through the veto.
            dev=[{**r,'features':[r['features'][0],r['features'][1],0,r['features'][3],r['features'][4]]} for r in dev]
            test=[{**r,'features':[r['features'][0],r['features'][1],0,r['features'][3],r['features'][4]]} for r in test]
        devp=softmax(classifier.decision_function(feature_matrix(dev,ablation)),temperature)
        threshold,veto,development_passed,development_selection=choose_threshold(dev,devp)
        testp=softmax(classifier.decision_function(feature_matrix(test,ablation)),temperature)
        result=metrics(test,testp,threshold,veto)
        base_types={'clean','partial','negation','unrelated','mixed'}
        base_indices=[i for i,r in enumerate(test) if r['perturbation'] in base_types]
        clean=metrics([test[i] for i in base_indices],testp[base_indices],threshold,veto)
        noisy={}
        for kind in ('typo','word_order'):
            indices=[i for i,r in enumerate(test) if r['perturbation'] in ((base_types-{'clean'})|{kind})]
            noisy[kind]=metrics([test[i] for i in indices],testp[indices],threshold,veto)
        degradation=max(clean['macro_f1']-value['macro_f1'] for value in noisy.values())
        result['noisy_macro_f1_degradation']=max(0,degradation)
        passed=(development_passed and result['accepted_precision'] is not None
                and result['accepted_precision']>=GATES['accepted_precision_min']
                and result['correct_accept_precision'] is not None and result['correct_accept_precision']>=GATES['accepted_precision_min']
                and result['contradiction_false_pass']<=GATES['contradiction_false_pass_max']
                and result['coverage']>=GATES['coverage_min']
                and degradation<=GATES['noisy_macro_f1_degradation_max'])
        release[language]={'passed':bool(passed),'development_passed':development_passed,'measured':result}
        thresholds[language]={label:threshold for label in LABELS}
        vetoes[language]=veto
        report[language]={'heldout':result,'development_selection':development_selection,
                         'development_at_frozen_threshold':metrics(dev,devp,threshold,veto),
                         'clean':clean,'noisy':noisy,
                         'concepts':concept_metrics(test),'paired_perturbations':paired_metrics(test,testp,threshold,veto),
                         'risk_coverage':[{'threshold':float(t),**metrics(test,testp,float(t),veto)} for t in np.linspace(.34,.99,12)]}
    return classifier,temperature,thresholds,vetoes,release,report


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--inference',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    dataset=Path(__file__).with_name('dataset.jsonl')
    canonical={row['id']:row for row in map(json.loads,dataset.read_text().splitlines())}
    rows=[json.loads(line) for line in args.inference.read_text().splitlines() if line]
    if len(rows)!=len(canonical) or len({row['id'] for row in rows})!=len(rows) or {r['id'] for r in rows}!=set(canonical):
        raise SystemExit('Full 4800-row real-checkpoint inference is required; partial/smoke results cannot calibrate.')
    for row in rows:
        expected=canonical[row['id']]
        if any(row.get(key)!=value for key,value in expected.items()) or row['model_versions']!=MODEL_VERSIONS or row['scorer_version']!=SCORER_VERSION:
            raise SystemExit('Dataset labels/splits or model/scorer versions do not match canonical inputs.')
    devices={row['device'] for row in rows}
    if len(devices)!=1: raise SystemExit('Mixed inference devices are not a reproducible calibration input')
    partitions={split:[r for r in rows if r['split']==split] for split in ('train','development','calibration','test')}
    family_sets=[{r['family_id'] for r in group} for group in partitions.values()]
    if any(left&right for i,left in enumerate(family_sets) for right in family_sets[i+1:]): raise SystemExit('Family leakage')
    reports={};artifact=None
    for variant in ('hybrid','embedding_only','nli_only'):
        model,temperature,thresholds,vetoes,release,report=evaluate_variant(partitions,variant)
        reports[variant]=report
        if variant=='hybrid':
            artifact={'schema_version':1,'id':hashlib.sha256(args.inference.read_bytes()).hexdigest()[:24],
                      'scorer_version':SCORER_VERSION,'feature_names':FEATURE_NAMES,'labels':LABELS,'model_versions':MODEL_VERSIONS,
                      'coefficients':model.coef_.tolist(),'intercepts':model.intercept_.tolist(),'temperature':temperature,
                      'thresholds':thresholds,'contradiction_veto':vetoes,'release_gates':release,'required_gates':GATES,'experimental':True,
                      'label_provenance':'synthetic_template_hypothesis','human_reviewed':False,
                      'supported_language_pairs':[['en',language] for language in ('en','hi','hi-Latn')],
                      'inference_device':next(iter(devices)),
                      'dataset_sha256':hashlib.sha256(dataset.read_bytes()).hexdigest(),
                      'inference_sha256':hashlib.sha256(args.inference.read_bytes()).hexdigest(),
                      'created_at':datetime.now(timezone.utc).isoformat()}
    args.output.mkdir(parents=True,exist_ok=True)
    (args.output/'calibration.json').write_text(json.dumps(artifact,indent=2)+'\n')
    (args.output/'evaluation.json').write_text(json.dumps({'experimental':True,'human_reviewed':False,
        'limitation':'Actual model performance on constructed labels; not evidence of real learner robustness.',
        'family_counts':{split:len({r['family_id'] for r in group}) for split,group in partitions.items()},
        'required_gates':GATES,'ablations':reports},indent=2)+'\n')
    print(json.dumps({'artifact':str(args.output/'calibration.json'),'languages':{lang:g['passed'] for lang,g in artifact['release_gates'].items()}},indent=2))


if __name__=='__main__': main()
