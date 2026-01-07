import pytest
from fastapi.testclient import TestClient


def test_extract_returns_five_words():
    from main import app
    client = TestClient(app)
    response = client.post("/extract", json={"source_type": "text", "content": "test passage"})
    assert response.status_code == 200
    data = response.json()
    assert len(data["words"]) == 5


def test_extract_words_have_required_fields():
    from main import app
    client = TestClient(app)
    response = client.post("/extract", json={"source_type": "text", "content": "test passage"})
    words = response.json()["words"]
    for word in words:
        assert word["word"]
        assert word["definition"]
        assert word["example_sentence"]


def test_extract_accepts_image_source_type():
    from main import app
    client = TestClient(app)
    response = client.post("/extract", json={"source_type": "image", "content": "base64string"})
    assert response.status_code == 200
