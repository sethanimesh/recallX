import io
import json
import time
import uuid

import fitz
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

import database
from ingestion import service, settings
from ingestion.models import Approval, Crop
from ingestion.parser import parse_pages, ParserUnavailable
from ingestion.worker import process_job
from routers.ingestion import router


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("RECALLX_DB_PATH", str(tmp_path / "test.sqlite"))
    monkeypatch.setattr(settings, "DATA_DIR", tmp_path / "assets")
    database.init_db()


def pdf_bytes(mixed=False, rotation=0):
    doc = fitz.open()
    page = doc.new_page(width=400, height=400)
    page.insert_textbox(fitz.Rect(30, 30, 370, 180), "Ephemeral means lasting for a short time. The ephemeral rainbow disappeared after the rain.")
    page.set_rotation(rotation)
    if mixed:
        page = doc.new_page(width=400, height=400)
        page.insert_image(page.rect, stream=image_bytes())
    data = doc.tobytes()
    doc.close()
    return data


def image_bytes():
    output = io.BytesIO()
    Image.new("RGB", (100, 100), "white").save(output, format="PNG")
    return output.getvalue()


def job(data=None, request_id=None):
    return service.submit(data or pdf_bytes(), "source.pdf", "application/pdf", request_id or str(uuid.uuid4()), "", None)


def extract(text, instructions):
    return [{"word": "ephemeral", "definition": "Lasting for a short time.", "example_sentence": "The rainbow was ephemeral."}]


def ocr(data):
    assert data.startswith(b"\x89PNG")
    return {"width": 800, "height": 800, "blocks": [{"text": "A multilingual paragraph describes a temporary event.", "kind": "text", "bbox": [20, 20, 600, 80], "confidence": None}]}


def test_multipart_upload_stores_pdf_bytes_and_job():
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        data = pdf_bytes()
        response = client.post("/ingestion/jobs", files={"file": ("lesson.pdf", data, "application/pdf")}, data={"request_id": "upload-1"})
        assert response.status_code == 202
        body = response.json()
        assert body["pages_total"] == 1 and body["status"] == "queued"
        source = client.get(f"/ingestion/sources/{body['source_id']}")
        assert source.content == data
        assert client.get("/ingestion/jobs").json()[0]["id"] == body["id"]


def test_native_pdf_known_good_exact_parse(tmp_path):
    path = tmp_path / "native.pdf"
    path.write_bytes(pdf_bytes())
    def forbidden(_):
        raise AssertionError("Native page must not invoke OCR")
    pages = list(parse_pages(str(path), "application/pdf", ocr=forbidden))
    assert len(pages) == 1
    assert pages[0]["method"] == "native-text"
    assert "Ephemeral means" in pages[0]["blocks"][0]["text"]
    assert len(pages[0]["blocks"][0]["bbox"]) == 4


def test_mixed_pdf_routes_each_page_once(tmp_path):
    path = tmp_path / "mixed.pdf"
    path.write_bytes(pdf_bytes(mixed=True))
    calls = []
    def tracked(data):
        calls.append(data)
        return ocr(data)
    pages = list(parse_pages(str(path), "application/pdf", ocr=tracked))
    assert [p["method"] for p in pages] == ["native-text", "paddleocr-vl-1.6"]
    assert len(calls) == 1
    assert pages[1]["blocks"][0]["bbox"] == [10, 10, 300, 40]


def test_rotated_pdf_coordinates_fit_displayed_page(tmp_path):
    path = tmp_path / "rotated.pdf"
    path.write_bytes(pdf_bytes(rotation=90))
    page = next(parse_pages(str(path), "application/pdf"))
    assert page["metadata"]["rotation"] == 90
    x1, y1, x2, y2 = page["blocks"][0]["bbox"]
    assert 0 <= x1 < x2 <= page["width"] and 0 <= y1 < y2 <= page["height"]


def test_crop_preserves_original_frame(tmp_path):
    path = tmp_path / "source.png"
    path.write_bytes(image_bytes())
    crop = Crop(originX=10, originY=20, width=50, height=60, originalWidth=100, originalHeight=100)
    def cropped(data):
        with Image.open(io.BytesIO(data)) as image:
            assert image.size == (50, 60)
        return {"width": 50, "height": 60, "blocks": [{"kind": "text", "text": "visible", "bbox": [0, 0, 50, 60]}]}
    page = next(parse_pages(str(path), "image/png", crop.model_dump(), ocr=cropped))
    assert page["blocks"][0]["bbox"] == [10, 20, 60, 80]
    assert page["width"] == 100
    assert page["metadata"]["derivative_sha256"] != page["metadata"]["preview_sha256"]


def test_multicolumn_native_text_requires_layout_parser(tmp_path):
    document = fitz.open()
    page = document.new_page(width=600, height=400)
    page.insert_textbox(fitz.Rect(20, 30, 270, 180), "Left column contains several complete sentences about natural history and a vivid landscape.")
    page.insert_textbox(fitz.Rect(330, 30, 580, 180), "Right column contains different complete sentences about languages and grammar.")
    path = tmp_path / "columns.pdf"
    document.save(path)
    parsed = list(parse_pages(str(path), "application/pdf", ocr=ocr))
    assert parsed[0]["method"] == "paddleocr-vl-1.6"


def test_invalid_pdf_and_password_protected_rejected():
    with pytest.raises(ValueError):
        job(b"%PDF-not-valid")
    doc = fitz.open(stream=pdf_bytes(), filetype="pdf")
    protected = doc.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="secret")
    with pytest.raises(ValueError, match="Password"):
        job(protected)


def test_upload_idempotency_and_conflict():
    data = pdf_bytes()
    first = job(data, "same")
    assert job(data, "same")["id"] == first["id"]
    with pytest.raises(service.IngestionError):
        service.submit(data, "x.pdf", "application/pdf", "same", "different", None)


def test_worker_durable_results_and_duplicate_delivery():
    created = job()
    calls = []
    def tracked(text, instructions):
        calls.append(text)
        return extract(text, instructions)
    process_job(created["id"], extractor=tracked)
    process_job(created["id"], extractor=tracked)
    result = service.get_job(created["id"])
    assert result["status"] == "ready" and result["pages_done"] == 1
    assert len(result["candidates"]) == 1 and len(calls) == 1
    citation = result["candidates"][0]["citations"][0]
    assert citation["page_number"] == 1 and citation["block_id"]


def test_retry_reuses_parsed_checkpoint():
    created = job()
    def failure(*args):
        raise RuntimeError("generator unavailable")
    process_job(created["id"], extractor=failure)
    assert service.get_job(created["id"])["status"] == "failed"
    service.retry(created["id"])
    def resume(path, mime, crop, done):
        assert done == {1}
        return iter(())
    process_job(created["id"], parser=resume, extractor=extract)
    assert service.get_job(created["id"])["status"] == "ready"


def test_cancel_fences_running_worker():
    created = job()
    def cancelled(text, instructions):
        service.cancel(created["id"])
        return extract(text, instructions)
    process_job(created["id"], extractor=cancelled)
    result = service.get_job(created["id"])
    assert result["status"] == "cancelled" and result["candidates"] == []


def test_parser_unavailable_is_failure_not_fake_success():
    created = job(image_bytes())
    def unavailable(*args):
        raise ParserUnavailable("model missing")
    process_job(created["id"], parser=unavailable, extractor=extract)
    result = service.get_job(created["id"])
    assert result["status"] == "failed" and result["error_code"] == "parser_unavailable"


def test_stale_worker_lease_recovered():
    from ingestion.dispatch import recover_jobs
    created = job()
    with database.connect() as conn:
        conn.execute("UPDATE ingestion_jobs SET status='parsing',lease_token='dead',lease_until=? WHERE id=?", (int(time.time()) - 1, created["id"]))
    recover_jobs()
    assert service.get_job(created["id"])["status"] == "queued"
    process_job(created["id"], extractor=extract)
    assert service.get_job(created["id"])["status"] == "ready"


def approval_for(created, request_id="accept"):
    process_job(created["id"], extractor=extract)
    candidate = service.get_job(created["id"])["candidates"][0]
    return Approval(request_id=request_id, candidates=[{**{k: candidate[k] for k in ("id", "word", "definition", "example_sentence")}, "accept": True}])


def test_atomic_approval_links_rubric_and_two_cards_idempotently():
    created = job()
    approval = approval_for(created)
    first = service.approve(created["id"], approval)
    assert service.approve(created["id"], approval) == first
    with database.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM words").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM memory_states").fetchone()[0] == 2
        assert conn.execute("SELECT status FROM rubrics").fetchone()[0] == "draft"
        assert conn.execute("SELECT COUNT(*) FROM item_sources").fetchone()[0] == 1
    assert service.get_job(created["id"])["status"] == "completed"


def test_invalid_tag_rolls_back_entire_approval():
    created = job()
    approval = approval_for(created)
    approval.candidates[0].tag_ids = ["missing"]
    with pytest.raises(service.IngestionError):
        service.approve(created["id"], approval)
    with database.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM words").fetchone()[0] == 0
    assert service.get_job(created["id"])["candidates"][0]["status"] == "pending"


def test_same_sense_reuses_item_and_preserves_schedule():
    one = job()
    service.approve(one["id"], approval_for(one, "first"))
    with database.connect() as conn:
        before = [dict(r) for r in conn.execute("SELECT * FROM memory_states")]
    two = job()
    result = service.approve(two["id"], approval_for(two, "second"))
    assert result["items"][0]["is_new"] is False
    with database.connect() as conn:
        assert [dict(r) for r in conn.execute("SELECT * FROM memory_states")] == before
        assert conn.execute("SELECT COUNT(*) FROM item_sources").fetchone()[0] == 2


def test_broker_failure_preserves_outbox(monkeypatch):
    from ingestion.dispatch import dispatch_pending
    from ingestion.tasks import run_job
    created = job()
    def unavailable(*args, **kwargs):
        raise ConnectionError("redis down")
    monkeypatch.setattr(run_job, "apply_async", unavailable)
    dispatch_pending()
    with database.connect() as conn:
        event = conn.execute("SELECT * FROM ingestion_outbox WHERE job_id=?", (created["id"],)).fetchone()
        assert event["dispatched_at"] is None and event["attempts"] == 1


def test_real_api_requires_authentication_and_allows_paired_upload(monkeypatch):
    from main import app
    from auth import digest
    monkeypatch.setenv("RECALLX_DISABLE_DISPATCH", "1")
    with database.connect() as conn:
        conn.execute("INSERT INTO devices VALUES(?,?,?,?,?,NULL)", ("paired", "personal", "Test phone", digest("token"), database.utcnow()))
    with TestClient(app) as client:
        assert client.get("/ingestion/jobs").status_code == 401
        headers = {"Authorization": "Bearer token"}
        response = client.post("/ingestion/jobs", files={"file": ("lesson.pdf", pdf_bytes(), "application/pdf")}, data={"request_id": "auth-upload"}, headers=headers)
        assert response.status_code == 202
        assert client.get(f"/ingestion/sources/{response.json()['source_id']}").status_code == 401
        assert client.get(f"/ingestion/sources/{response.json()['source_id']}", headers=headers).status_code == 200


def test_text_contract_and_explicit_mcq_mode():
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        response = client.post("/ingestion/text", json={"request_id": "text", "text": "Ephemeral is a word meaning short-lived.", "extraction_mode": "vocabulary_mcq"})
        assert response.status_code == 202
        created = response.json()
        assert created["extraction_mode"] == "vocabulary_mcq"
        def tracked(text, instructions):
            assert "multiple-choice" in instructions
            return extract(text, instructions)
        process_job(created["id"], extractor=tracked)
        candidate = service.get_job(created["id"])["candidates"][0]
        assert candidate["citations"][0]["bbox"] is None


def test_draft_saved_and_source_correction_requeues_without_false_alignment():
    app = FastAPI()
    app.include_router(router)
    created = job()
    approval = approval_for(created)
    with TestClient(app) as client:
        draft = {**approval.model_dump(), "operation_id": str(uuid.uuid4()), "expected_revision": 0}
        assert client.put(f"/ingestion/jobs/{created['id']}/draft", json=draft).status_code == 200
        assert client.get(f"/ingestion/jobs/{created['id']}/draft").json()["candidates"][0]["id"] == approval.candidates[0].id
        before = service.get_job(created["id"])["candidates"][0]
        block_id = before["citations"][0]["block_id"]
        correction = {"operation_id": str(uuid.uuid4()), "expected_revision": 1,
                      "text": "Corrected reference for a lasting memory."}
        response = client.patch(f"/ingestion/jobs/{created['id']}/blocks/{block_id}", json=correction)
        assert response.status_code == 200 and response.json()["status"] == "queued"
        # A lost acknowledgement is replayed while queued and after regeneration.
        assert client.patch(f"/ingestion/jobs/{created['id']}/blocks/{block_id}", json=correction).json() == response.json()
        process_job(created["id"], extractor=extract)
        after = service.get_job(created["id"])["candidates"][0]
        assert after["id"] != before["id"]
        assert "Corrected" in after["citations"][0]["excerpt"]
        assert client.patch(f"/ingestion/jobs/{created['id']}/blocks/{block_id}", json=correction).json() == response.json()
        assert service.get_job(created["id"])["candidates"][0]["id"] == after["id"]
        page = client.get(f"/ingestion/jobs/{created['id']}/pages/1").json()
        assert page["blocks"][0]["revision"] == 2
        conflict = client.patch(f"/ingestion/jobs/{created['id']}/blocks/{block_id}", json={**correction, "text": "Different text"})
        assert conflict.status_code == 409
        stale = client.patch(f"/ingestion/jobs/{created['id']}/blocks/{block_id}", json={**correction, "operation_id": str(uuid.uuid4())})
        assert stale.status_code == 409
        second = {"operation_id": str(uuid.uuid4()), "expected_revision": 2, "text": "A second correction."}
        assert client.patch(f"/ingestion/jobs/{created['id']}/blocks/{block_id}", json=second).status_code == 200
    with database.connect() as conn:
        history = conn.execute("SELECT * FROM ingestion_source_corrections ORDER BY after_revision").fetchall()
        assert len(history) == 2
        assert history[0]["original_text"].startswith("Ephemeral means")
        assert history[0]["corrected_text"] == correction["text"]
        assert history[1]["original_text"] == correction["text"]
        assert history[1]["corrected_text"] == second["text"]
        assert [row["after_revision"] for row in history] == [2, 3]
        assert conn.execute("SELECT COUNT(*) FROM ingestion_outbox WHERE job_id=?", (created["id"],)).fetchone()[0] == 3


def test_source_correction_and_dispatch_roll_back_together(monkeypatch):
    app = FastAPI()
    app.include_router(router)
    created = job()
    approval_for(created)
    block_id = service.get_job(created["id"])["candidates"][0]["citations"][0]["block_id"]
    def fail_enqueue(*args):
        raise RuntimeError("Interrupted before dispatch commit")
    monkeypatch.setattr(service, "enqueue", fail_enqueue)
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.patch(f"/ingestion/jobs/{created['id']}/blocks/{block_id}", json={
            "operation_id": str(uuid.uuid4()), "expected_revision": 1, "text": "Must not persist"})
        assert response.status_code == 500
    with database.connect() as conn:
        assert conn.execute("SELECT revision FROM ingestion_blocks WHERE id=?", (block_id,)).fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM ingestion_source_corrections").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM operations WHERE kind='source_correction'").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM ingestion_candidates WHERE job_id=?", (created["id"],)).fetchone()[0] == 1
    assert service.get_job(created["id"])["status"] == "ready"


def test_concurrent_source_correction_delivery_commits_one_revision():
    from concurrent.futures import ThreadPoolExecutor
    import sqlite3
    from threading import Barrier
    app = FastAPI()
    app.include_router(router)
    created = job()
    approval_for(created)
    block_id = service.get_job(created["id"])["candidates"][0]["citations"][0]["block_id"]
    correction = {"operation_id": str(uuid.uuid4()), "expected_revision": 1, "text": "One accepted correction."}
    barrier = Barrier(2)
    def submit_once():
        with TestClient(app) as client:
            barrier.wait()
            response = client.patch(f"/ingestion/jobs/{created['id']}/blocks/{block_id}", json=correction)
            assert response.status_code == 200
            return response.json()
    with ThreadPoolExecutor(max_workers=2) as executor:
        first, second = list(executor.map(lambda _: submit_once(), range(2)))
    assert first == second
    with database.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM ingestion_source_corrections").fetchone()[0] == 1
        assert conn.execute("SELECT revision FROM ingestion_blocks WHERE id=?", (block_id,)).fetchone()[0] == 2
        assert conn.execute("SELECT COUNT(*) FROM ingestion_outbox WHERE job_id=?", (created["id"],)).fetchone()[0] == 2
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            conn.execute("UPDATE ingestion_source_corrections SET corrected_text='rewritten'")
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            conn.execute("DELETE FROM ingestion_source_corrections")


def test_delayed_cancel_and_retry_acknowledgements_do_not_repeat_control_actions():
    app = FastAPI()
    app.include_router(router)
    created = job()
    cancel = {"operation_id": str(uuid.uuid4()), "expected_revision": 1}
    resume = {"operation_id": str(uuid.uuid4()), "expected_revision": 2}
    prefix = f"/ingestion/jobs/{created['id']}"
    with TestClient(app) as client:
        first = client.post(prefix + "/cancel", json=cancel)
        assert first.status_code == 200 and first.json()["control_revision"] == 2
        restarted = client.post(prefix + "/retry", json=resume)
        assert restarted.status_code == 202 and restarted.json()["control_revision"] == 3
        assert client.post(prefix + "/cancel", json=cancel).json() == first.json()
        assert service.get_job(created["id"])["status"] == "queued"
        assert client.post(prefix + "/cancel", json={**cancel, "operation_id": str(uuid.uuid4())}).status_code == 409
        assert client.post(prefix + "/cancel", json={**cancel, "expected_revision": 3}).status_code == 409
        process_job(created["id"], extractor=extract)
        assert client.post(prefix + "/retry", json=resume).json() == restarted.json()
        assert service.get_job(created["id"])["status"] == "ready"
    with database.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM ingestion_outbox WHERE job_id=?", (created["id"],)).fetchone()[0] == 2
        assert conn.execute("SELECT COUNT(*) FROM operations WHERE kind IN ('ingestion_cancel','ingestion_retry')").fetchone()[0] == 2


def test_draft_revisions_and_receipts_protect_newer_edits_and_approval():
    app = FastAPI()
    app.include_router(router)
    created = job()
    approval = approval_for(created)
    prefix = f"/ingestion/jobs/{created['id']}"
    first = {**approval.model_dump(), "operation_id": str(uuid.uuid4()), "expected_revision": 0}
    changed = json.loads(json.dumps(first))
    changed["operation_id"] = str(uuid.uuid4())
    changed["expected_revision"] = 1
    changed["candidates"][0]["definition"] = "Updated carefully on another device."
    with TestClient(app) as client:
        assert client.get(prefix + "/draft").json()["revision"] == 0
        saved = client.put(prefix + "/draft", json=first)
        assert saved.status_code == 200 and saved.json() == {"saved": True, "revision": 1}
        assert client.put(prefix + "/draft", json=changed).json()["revision"] == 2
        assert client.put(prefix + "/draft", json=first).json() == saved.json()
        stale = {**first, "operation_id": str(uuid.uuid4())}
        assert client.put(prefix + "/draft", json=stale).status_code == 409
        collision = {**changed, "operation_id": first["operation_id"]}
        assert client.put(prefix + "/draft", json=collision).status_code == 409
        remote = client.get(prefix + "/draft").json()
        assert remote["revision"] == 2
        assert remote["candidates"][0]["definition"] == changed["candidates"][0]["definition"]
        assert client.post(prefix + "/approve", json={**approval.model_dump(), "expected_draft_revision": 1}).status_code == 409
        current = {"request_id": approval.request_id, "candidates": remote["candidates"], "expected_draft_revision": 2}
        accepted = client.post(prefix + "/approve", json=current)
        assert accepted.status_code == 200
        assert client.post(prefix + "/approve", json=current).json() == accepted.json()
        assert client.put(prefix + "/draft", json=first).json() == saved.json()
    with database.connect() as conn:
        assert conn.execute("SELECT definition FROM words").fetchone()[0] == changed["candidates"][0]["definition"]


def test_transient_extraction_retries_are_bounded(monkeypatch):
    import httpx
    from ingestion import worker
    monkeypatch.setattr(worker.time, "sleep", lambda duration: None)
    created = job()
    calls = []
    def transient(text, instructions):
        calls.append(text)
        raise httpx.ConnectError("temporarily unavailable")
    process_job(created["id"], extractor=transient)
    assert len(calls) == 3
    result = service.get_job(created["id"])
    assert result["status"] == "failed" and result["pages_done"] == 1


def test_accepted_item_provenance_keeps_page_citations_and_private_asset_links():
    app = FastAPI()
    app.include_router(router)
    created = job()
    accepted = service.approve(created["id"], approval_for(created))
    item_id = accepted["items"][0]["item_id"]
    with database.connect() as conn:
        stored = conn.execute("SELECT id,metadata_json FROM ingestion_pages WHERE job_id=?", (created["id"],)).fetchone()
        metadata = {**json.loads(stored["metadata_json"]), "raw_parser_output": {"input_path": "/private/worker/page.png"}}
        conn.execute("UPDATE ingestion_pages SET metadata_json=? WHERE id=?", (json.dumps(metadata), stored["id"]))
    with TestClient(app) as client:
        response = client.get(f"/ingestion/items/{item_id}/sources")
        assert response.status_code == 200
        source = response.json()["sources"][0]
        assert source["source_id"] == created["source_id"]
        assert source["citations"][0]["page_number"] == 1
        assert source["citations"][0]["bbox"]
        assert "storage_path" not in source
        assert "raw_parser_output" not in source["pages"][0]["metadata"]
        assert "raw_parser_output" not in client.get(f"/ingestion/jobs/{created['id']}/pages/1").json()["metadata"]
        assert client.get(source["source_path"]).content.startswith(b"%PDF")
        assert client.get(source["pages"][0]["preview_path"]).content.startswith(b"\x89PNG")
        assert client.get("/ingestion/items/missing/sources").status_code == 404
    with database.connect() as conn:
        conn.execute("UPDATE ingestion_sources SET learner_id='another' WHERE id=?", (created["source_id"],))
    with TestClient(app) as client:
        assert client.get(f"/ingestion/items/{item_id}/sources").json()["sources"] == []
