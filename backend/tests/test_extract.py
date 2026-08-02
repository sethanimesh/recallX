import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


@pytest.mark.parametrize("payload", [
    {"input_type": "text", "content": "A document passage"},
    {"input_type": "image", "content": "ZmFrZQ==", "mime_type": "image/jpeg"},
    {"input_type": "text", "content": "file:///private/document.pdf"},
])
def test_legacy_document_extraction_redirects_to_durable_jobs(payload):
    response = client.post("/extract", json=payload)
    assert response.status_code == 410
    assert "/ingestion/jobs" in response.json()["detail"]
