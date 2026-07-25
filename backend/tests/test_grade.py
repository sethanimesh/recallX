"""Regression contracts replacing the obsolete generative /grade tests."""
import uuid
from unittest.mock import AsyncMock
from fastapi import FastAPI
from fastapi.testclient import TestClient
from assessment.contracts import AssessmentResult
from routers import grade


def test_grade_alias_uses_canonical_assessment(monkeypatch):
    app=FastAPI();app.include_router(grade.router)
    attempt=str(uuid.uuid4())
    result=AssessmentResult(id=attempt,assessment_id=attempt,item_id='item',content_revision=1,
                            feedback='Clarify your explanation.',reason='low_confidence',versions={})
    mocked=AsyncMock(return_value=result)
    monkeypatch.setattr(grade,'assess',mocked)
    with TestClient(app) as client:
        response=client.post('/grade',json={'item_id':'item','answer':'temporary','attempt_id':attempt,'content_revision':1})
    assert response.status_code==200
    assert response.json()['decision']=='uncertain'
    mocked.assert_awaited_once()


def test_grade_rejects_client_reference_definition():
    app=FastAPI();app.include_router(grade.router)
    with TestClient(app) as client:
        response=client.post('/grade',json={'word':'ephemeral','stored_definition':'anything','user_answer':'anything'})
    assert response.status_code==422
