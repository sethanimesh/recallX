"""Exercise the frozen artifact through assessment/tutor HTTP contracts in a temporary DB.

This does not modify calibration, load checkpoints, or touch learner data. Provider
credentials are blanked before imports; any generative grading call fails the check.
"""
import argparse
from contextlib import ExitStack
import json
import os
from pathlib import Path
import sys
import tempfile
from unittest.mock import AsyncMock, Mock, patch
import uuid

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
PROVIDER_KEYS = ('OPENAI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY',
                 'OLLAMA_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY',
                 'MISTRAL_API_KEY', 'HF_API_KEY', 'HF_TOKEN')


def verify(artifact_path, output):
    for key in PROVIDER_KEYS:
        os.environ[key] = ''
    os.environ['PROVIDER_PRIORITY'] = ''
    # Import after clearing credentials so .env.local cannot restore them.
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from openai.resources.chat.completions import AsyncCompletions, Completions
    import database
    from assessment import service
    from assessment.inference import MODEL_VERSIONS
    from assessment.scoring import load_artifact
    from providers.chain import ProviderChain
    from routers import grade, tutor

    artifact = load_artifact(str(artifact_path), MODEL_VERSIONS)
    if artifact is None:
        raise RuntimeError('Frozen calibration artifact is invalid')
    if any(gate.get('passed') for gate in artifact['release_gates'].values()):
        raise RuntimeError('This check expects the frozen all-abstention release artifact')

    inference = AsyncMock(side_effect=AssertionError('Failed gates must not invoke models'))
    chain_creation = Mock(side_effect=AssertionError('Assessment must not construct ProviderChain'))
    chat_async = AsyncMock(side_effect=AssertionError('Assessment must not call chat completions'))
    chat_sync = Mock(side_effect=AssertionError('Assessment must not call chat completions'))
    speech = AsyncMock(side_effect=RuntimeError('Speech deliberately unavailable'))
    outcomes = []
    with tempfile.TemporaryDirectory(prefix='recallx-frozen-gates-') as directory, ExitStack() as stack:
        stack.enter_context(patch.dict(os.environ, {
            'RECALLX_DB_PATH': str(Path(directory) / 'gates.sqlite'),
            'RECALLX_DATA_DIR': directory,
            'RECALLX_CALIBRATION_PATH': str(artifact_path.resolve()),
        }))
        stack.enter_context(patch.object(service.models, 'infer', inference))
        stack.enter_context(patch.object(ProviderChain, '__init__', chain_creation))
        stack.enter_context(patch.object(AsyncCompletions, 'create', chat_async))
        stack.enter_context(patch.object(Completions, 'create', chat_sync))
        stack.enter_context(patch.object(tutor, 'synthesize', speech))
        database.init_db()
        with database.connect() as conn:
            conn.execute('INSERT INTO words(id,word,definition,example_sentence,created_at,updated_at,sense_id) VALUES(?,?,?,?,?,?,?)',
                         ('gate-item', 'ephemeral', 'lasting a short time', '', 1, 1, 'gate-sense'))
            conn.execute('UPDATE learner_settings SET experimental_grading=1')
        app = FastAPI()
        app.include_router(grade.router)
        app.include_router(tutor.router)
        with TestClient(app) as client:
            draft = client.put('/items/gate-item/rubric', json={'content_revision': 1,
                'concepts': [{'id': 'duration', 'text': 'lasting a short time'}]})
            assert draft.status_code == 200, draft.text
            approved = client.post(f'/items/gate-item/rubrics/{draft.json()["revision"]}/approve', json={'content_revision': 1})
            assert approved.status_code == 200, approved.text
            for route in ('/assessments', '/tutor/chat', '/tutor/chat_and_speak'):
                for language, answer in (('en', 'lasting a short time'), ('hi', 'थोड़े समय तक रहने वाला'), ('hi-Latn', 'thode samay tak rehne wala')):
                    response = client.post(route, json={'item_id': 'gate-item', 'answer': answer,
                        'attempt_id': str(uuid.uuid4()), 'content_revision': 1, 'language': language})
                    assert response.status_code == 200, response.text
                    body = response.json()
                    result = body.get('assessment', body)
                    assert result['decision'] == 'uncertain' and result['reason'] == 'calibration_unavailable'
                    assert result['experimental'] and result['versions']['calibration'] == artifact['id']
                    if route == '/tutor/chat_and_speak':
                        assert body['audio_error'] and body['audio_b64'] is None
                    outcomes.append({'route': route, 'language': language, 'decision': result['decision'],
                                     'reason': result['reason'], 'calibration_id': result['versions']['calibration']})
        with database.connect() as conn:
            assessments = conn.execute('SELECT COUNT(*) FROM assessments').fetchone()[0]
            reviews = conn.execute('SELECT COUNT(*) FROM review_events').fetchone()[0]
        assert assessments == 9 and reviews == 0
    assert not any(os.environ.get(key) for key in PROVIDER_KEYS)
    for mock in (inference, chain_creation, chat_async, chat_sync):
        mock.assert_not_called()
    report = {
        'source': 'Temporary-database HTTP contract check using the actual frozen calibration artifact; model invocation and generative grading were prohibited. No learner data modified.',
        'experimental_opt_in': True, 'approved_rubric': True,
        'generative_provider_credentials_disabled': list(PROVIDER_KEYS),
        'provider_chain_constructions': chain_creation.call_count,
        'chat_completion_calls': chat_async.call_count + chat_sync.call_count,
        'model_calls': inference.call_count, 'outcomes': outcomes,
        'assessments': assessments, 'review_events': reviews,
        'audio_failure_checks': speech.call_count,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'outcomes'}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--artifact', type=Path, default=Path(__file__).parent / 'results/calibration/calibration.json')
    parser.add_argument('--output', type=Path, default=Path(__file__).parent / 'results/gate-enforcement.json')
    options = parser.parse_args()
    verify(options.artifact, options.output)
