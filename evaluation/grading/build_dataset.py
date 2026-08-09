"""Deterministic synthetic fixtures. Labels are construction hypotheses, not human annotations."""
import hashlib
import json
from pathlib import Path
import random

ROOT=Path(__file__).resolve().parent
SEED=20260928
LANGUAGES=('en','hi','hi-Latn')
TYPES=('clean','paraphrase','typo','word_order','partial','negation','unrelated','mixed')


def build():
    rows=[line.split('|') for line in (ROOT/'seeds.tsv').read_text().splitlines() if line and not line.startswith('#')]
    assert len(rows)==200 and len({r[0] for r in rows})==200
    order=list(range(200));random.Random(SEED).shuffle(order)
    splits={index:('train' if pos<80 else 'development' if pos<120 else 'calibration' if pos<160 else 'test') for pos,index in enumerate(order)}
    output=[]
    for i,row in enumerate(rows):
        word=row[0]
        concepts=[{'id':'core','text':row[1],'weight':1,'required':True,'accepted_alternatives':[],'qualifiers':[],'misconceptions':[]},
                  {'id':'qualifier','text':f'{row[1]}, specifically {row[2]}','weight':1,'required':True,'accepted_alternatives':[],'qualifiers':[],'misconceptions':[]}]
        for lang_index,language in enumerate(LANGUAGES):
            core,qualifier=row[1+lang_index*2:3+lang_index*2]
            complete=f'{core}, {qualifier}'
            # Even the text used as an unrelated distractor stays inside the family partition.
            peers=[index for index in range(len(rows)) if splits[index]==splits[i]]
            other=rows[peers[(peers.index(i)+len(peers)//2+1)%len(peers)]]
            unrelated=', '.join(other[1+lang_index*2:3+lang_index*2])
            if language=='en':
                forms=[complete,f'The meaning is {complete}.',f'The meaining is {complete}.',f'{qualifier}; {core}.',core,f'It does not mean {complete}.',unrelated,f'{complete}. But it does not mean {complete}.']
            elif language=='hi':
                forms=[complete,f'इसका अर्थ है {complete}।',f'इसका अरथ है {complete}।',f'{qualifier}; {core}।',core,f'इसका अर्थ {complete} नहीं है।',unrelated,f'{complete}। लेकिन इसका अर्थ {complete} नहीं है।']
            else:
                forms=[complete,f'Iska matlab hai {complete}.',f'Iska matlb hai {complete}.',f'{qualifier}; {core}.',core,f'Iska matlab {complete} nahi hai.',unrelated,f'{complete}. Lekin iska matlab {complete} nahi hai.']
            for kind,answer in zip(TYPES,forms):
                label='correct' if kind in TYPES[:4] else 'partial' if kind=='partial' else 'incorrect'
                output.append({'id':f'{word}:{language}:{kind}','family_id':word,'split':splits[i],
                    'word':word,'concepts':concepts,'answer':answer,'language':language,'perturbation':kind,
                    'label':label,'concept_labels':{'core':'support' if kind in TYPES[:5] else 'contradiction' if kind in ('negation','mixed') else 'neutral',
                    'qualifier':'support' if kind in TYPES[:4] else 'neutral' if kind in ('partial','unrelated') else 'contradiction'},
                    'label_provenance':'synthetic_template_hypothesis','human_reviewed':False,'experimental_only':True})
    data=''.join(json.dumps(row,ensure_ascii=False,sort_keys=True)+'\n' for row in output)
    (ROOT/'dataset.jsonl').write_text(data)
    manifest={'schema_version':1,'seed':SEED,'families':200,'rows':len(output),'languages':LANGUAGES,'types':TYPES,
              'split_families':{'train':80,'development':40,'calibration':40,'test':40},
              'sha256':hashlib.sha256(data.encode()).hexdigest(),'source':'project-authored synthetic vocabulary fixtures',
              'human_reviewed':False,'limitation':'Constructed labels are hypotheses; neither multilingual validity nor real learner quality is established.'}
    (ROOT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(manifest,indent=2))


if __name__=='__main__': build()
