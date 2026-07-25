"""Real Qwen3 embeddings and mDeBERTa NLI, imported only inside a bounded worker."""
import hashlib
import json
import os
import re
from pathlib import Path

os.environ.setdefault('HF_HOME', str(Path(__file__).resolve().parents[2] / 'models' / 'huggingface'))

EMBEDDING_ID = 'Qwen/Qwen3-Embedding-0.6B'
EMBEDDING_REVISION = '97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3'
NLI_ID = 'MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7'
NLI_REVISION = 'b5113eb38ab63efdd7f280f8c144ea8b13f978ce'
MODEL_VERSIONS = {'embedding': EMBEDDING_REVISION, 'nli': NLI_REVISION, 'precision': 'float32', 'encoding': 'qwen-reference-query-v1'}


class InputTooLong(ValueError):
    pass


class DiscriminativeModels:
    def __init__(self):
        import torch
        from sentence_transformers import SentenceTransformer
        from transformers import AutoTokenizer, AutoModelForSequenceClassification

        self.torch = torch
        torch.set_num_threads(2)
        self.device = os.environ.get('RECALLX_GRADING_DEVICE', 'cpu')
        if self.device not in ('cpu', 'mps'):
            raise ValueError('Supported grading devices: cpu, mps')
        self.embedding = SentenceTransformer(EMBEDDING_ID, revision=EMBEDDING_REVISION,
            local_files_only=True, device=self.device, model_kwargs={'torch_dtype': torch.float32})
        self.embedding.max_seq_length = 512
        self.tokenizer = AutoTokenizer.from_pretrained(NLI_ID, revision=NLI_REVISION, local_files_only=True)
        self.nli = AutoModelForSequenceClassification.from_pretrained(NLI_ID, revision=NLI_REVISION,
            local_files_only=True, torch_dtype=torch.float32).to(self.device).eval()
        self.labels = {str(v).lower(): int(k) for k,v in self.nli.config.id2label.items()}
        if set(self.labels) != {'entailment','neutral','contradiction'}:
            raise ValueError('Unrecognized NLI checkpoint label mapping')
        self.embedding.eval()
        self.cache = Path(os.environ.get('RECALLX_DATA_DIR', str(Path(__file__).resolve().parents[1] / 'data'))) / 'embeddings'
        self.cache.mkdir(parents=True, exist_ok=True)

    def spans(self, answer):
        tokens = self.tokenizer.encode(answer, add_special_tokens=False)
        if len(tokens) > 2048:
            raise InputTooLong('Answer exceeds 2048 NLI tokens')
        # No spelling correction, stop-word stripping, or negation removal.
        clauses = [s.strip() for s in re.split(r'(?<=[.!?।;])\s+|\n+|\s+(?=but\b|however\b|लेकिन\b|परंतु\b)', answer) if s.strip()]
        spans = []
        for clause in clauses:
            ids = self.tokenizer.encode(clause, add_special_tokens=False)
            for start in range(0, max(len(ids), 1), 168):
                spans.append(self.tokenizer.decode(ids[start:start+200], skip_special_tokens=True))
                if start + 200 >= len(ids):
                    break
        if len(spans) > 16:
            raise InputTooLong('Answer exceeds 16 semantic spans')
        if any(len(self.embedding.tokenizer.encode(span)) > 500 for span in spans):
            raise InputTooLong('A span exceeds the embedding context limit')
        return spans

    def reference_embeddings(self, texts, rubric_key):
        import numpy as np
        key = hashlib.sha256(json.dumps([MODEL_VERSIONS,self.device,rubric_key,texts],ensure_ascii=False).encode()).hexdigest()
        path = self.cache / (key + '.npy')
        if path.exists():
            try:
                value = np.load(path, allow_pickle=False)
                if value.shape == (len(texts), 1024) and np.isfinite(value).all():
                    return value
            except (OSError,ValueError):
                pass
        queries = ['Instruct: Given a learner explanation, retrieve text that expresses the reference meaning.\nQuery: ' + t for t in texts]
        if any(len(self.embedding.tokenizer.encode(query)) > 500 for query in queries):
            raise InputTooLong('A reference exceeds the embedding context limit')
        with self.torch.inference_mode():
            value = self.embedding.encode(queries, batch_size=1, normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False)
        temporary = path.with_suffix('.tmp.npy')
        np.save(temporary, value, allow_pickle=False)
        temporary.replace(path)
        return value

    def classify_pairs(self, premises, hypotheses):
        output = []
        for premise,hypothesis in zip(premises,hypotheses):
            encoded = self.tokenizer(premise, hypothesis, return_tensors='pt', truncation=False)
            if encoded['input_ids'].shape[1] > 512:
                raise InputTooLong('NLI pair exceeds checkpoint context')
            with self.torch.inference_mode():
                logits = self.nli(**{k:v.to(self.device) for k,v in encoded.items()}).logits
                probs = self.torch.softmax(logits.float(), dim=-1)[0].cpu().tolist()
            output.append({label: float(probs[index]) for label,index in self.labels.items()})
        return output

    def assess(self, answer, word, concepts, rubric_key):
        import numpy as np
        spans = self.spans(answer)
        if not spans:
            return []
        with self.torch.inference_mode():
            span_embeddings = self.embedding.encode(spans, batch_size=1, normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False)
        results = []
        for concept in concepts:
            references = [concept['text']] + concept.get('accepted_alternatives', [])
            refs = self.reference_embeddings(references, rubric_key + ':' + concept['id'])
            similarities = span_embeddings @ refs.T
            # All spans undergo NLI. Embedding alignment weights support; it never suppresses contradiction checks.
            hypotheses = [f'The meaning of "{word}" is: {text}' for text in references]
            premises = [f'The learner explains "{word}" as: {span}' for span in spans]
            nli_by_ref = [self.classify_pairs(premises, [hyp]*len(spans)) for hyp in hypotheses]
            supports = [(max(0.0,float(similarities[i,j])) * nli_by_ref[j][i]['entailment'],i,j)
                        for i in range(len(spans)) for j in range(len(references))]
            support,best_i,best_j = max(supports)
            # A clause contradicting every approved equivalent is contrary evidence. Do not cherry-pick support.
            contradictions = [min(nli_by_ref[j][i]['contradiction'] for j in range(len(references))) for i in range(len(spans))]
            conflict_i = int(np.argmax(contradictions))
            contradiction = contradictions[conflict_i]
            qualifiers = []
            for qualifier in concept.get('qualifiers', []):
                scores = self.classify_pairs(premises, [f'The explanation specifies: {qualifier}']*len(spans))
                entailment = max(x['entailment'] for x in scores)
                qualifiers.append({'text':qualifier,'support':entailment})
                support = min(support, entailment)
                qualifier_conflict = max(range(len(scores)), key=lambda i: scores[i]['contradiction'])
                if scores[qualifier_conflict]['contradiction'] > contradiction:
                    contradiction = scores[qualifier_conflict]['contradiction']
                    conflict_i = qualifier_conflict
            misconceptions = []
            for misconception in concept.get('misconceptions', []):
                scores = self.classify_pairs(premises, [f'The meaning of "{word}" is: {misconception}']*len(spans))
                entailment = max(x['entailment'] for x in scores)
                misconceptions.append({'text':misconception,'support':entailment})
                if entailment > contradiction:
                    contradiction = entailment
                    conflict_i = max(range(len(scores)), key=lambda i: scores[i]['entailment'])
            best = nli_by_ref[best_j][best_i]
            results.append({'concept_id':concept['id'],'text':concept['text'],'required':concept.get('required',True),
                'weight':concept.get('weight',1),'alignment':float(similarities[best_i,best_j]),
                'entailment':best['entailment'],'neutrality':best['neutral'],'contradiction':contradiction,
                'support':support,'evidence_span':spans[best_i],
                'contradiction_span':spans[conflict_i] if contradiction > best['entailment'] else None,
                'qualifier_support':qualifiers,'misconception_support':misconceptions})
        return results
