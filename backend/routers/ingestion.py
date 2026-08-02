import json
from pathlib import Path
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool
import database
from ingestion import service, settings
from ingestion.models import Approval, Crop, TextUpload, BlockCorrection, DraftSave, JobMutation

router = APIRouter(prefix="/ingestion", tags=["ingestion"])


def learner(request):
    return getattr(request.state, "learner_id", "personal")


def call(fn, *args):
    try:
        return fn(*args)
    except service.IngestionError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/jobs", status_code=202)
async def upload(request: Request, file: UploadFile = File(...), request_id: str = Form(..., max_length=100), instructions: str = Form("", max_length=2000), crop: str | None = Form(None), extraction_mode: str = Form("general_document")):
    data = await file.read(settings.MAX_UPLOAD_BYTES + 1)
    if len(data) > settings.MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Upload exceeds 20 MB")
    try:
        crop_model = Crop.model_validate_json(crop) if crop else None
    except ValueError as exc:
        raise HTTPException(422, "Invalid crop metadata") from exc
    if not request_id.strip():
        raise HTTPException(422, "A stable request ID is required")
    result = await run_in_threadpool(call, service.submit, data, file.filename or "document", file.content_type or "", request_id, instructions, crop_model, learner(request), extraction_mode)
    # Durable outbox is dispatched by API recovery loop / Celery beat, never inline heavy work.
    return result


@router.get("/jobs")
def jobs(request: Request):
    return service.list_jobs(learner(request))


@router.post("/text", status_code=202)
def text_upload(body: TextUpload, request: Request):
    return call(service.submit, body.text.encode("utf-8"), "Pasted text.txt", "text/plain", body.request_id, body.instructions, None, learner(request), body.extraction_mode)


@router.get("/jobs/{job_id}")
def job(job_id: str, request: Request):
    return call(service.get_job, job_id, learner(request))


@router.post("/jobs/{job_id}/cancel")
def cancel(job_id: str, body: JobMutation, request: Request):
    return call(service.cancel, job_id, learner(request), body)


@router.post("/jobs/{job_id}/retry", status_code=202)
def retry(job_id: str, body: JobMutation, request: Request):
    return call(service.retry, job_id, learner(request), body)


@router.post("/jobs/{job_id}/approve")
def approve(job_id: str, body: Approval, request: Request):
    return call(service.approve, job_id, body, learner(request))


@router.put("/jobs/{job_id}/draft")
def save_draft(job_id: str, body: DraftSave, request: Request):
    import time
    operation_id = str(body.operation_id)
    learner_id = learner(request)
    payload = json.dumps({"job_id": job_id, **body.model_dump(mode="json")}, sort_keys=True)
    with database.connect(immediate=True) as conn:
        prior = conn.execute("SELECT * FROM operations WHERE id=?", (operation_id,)).fetchone()
        if prior:
            if prior["learner_id"] != learner_id or prior["kind"] != "ingestion_draft" or prior["payload_json"] != payload:
                raise HTTPException(409, "Draft operation ID collision")
            return json.loads(prior["response_json"])
        job = conn.execute("SELECT status,draft_revision FROM ingestion_jobs WHERE id=? AND learner_id=?", (job_id, learner_id)).fetchone()
        if not job:
            raise HTTPException(404, "Import not found")
        if job["status"] != "ready":
            raise HTTPException(409, "This import cannot be edited")
        if body.expected_revision != job["draft_revision"]:
            raise HTTPException(409, "Import draft changed on another device; refresh before saving")
        valid = {r[0] for r in conn.execute("SELECT id FROM ingestion_candidates WHERE job_id=? AND status='pending'", (job_id,))}
        if any(c.id not in valid for c in body.candidates):
            raise HTTPException(422, "Invalid draft candidate")
        conn.execute("INSERT OR REPLACE INTO ingestion_stages VALUES(?,'review-draft','saved',?,?)", (job_id, body.model_dump_json(exclude={"operation_id", "expected_revision"}), int(time.time())))
        revision = job["draft_revision"] + 1
        conn.execute("UPDATE ingestion_jobs SET draft_revision=? WHERE id=?", (revision, job_id))
        result = {"saved": True, "revision": revision}
        conn.execute("INSERT INTO operations VALUES(?,?,?,?,?,?)", (operation_id, learner_id, "ingestion_draft", database.utcnow(), payload, json.dumps(result)))
        return result


@router.get("/jobs/{job_id}/draft")
def get_draft(job_id: str, request: Request):
    with database.connect() as conn:
        conn.execute("BEGIN")
        job = conn.execute("SELECT draft_revision FROM ingestion_jobs WHERE id=? AND learner_id=?", (job_id, learner(request))).fetchone()
        if not job:
            raise HTTPException(404, "Import not found")
        row = conn.execute("SELECT result_json,updated_at FROM ingestion_stages WHERE job_id=? AND stage_key='review-draft'", (job_id,)).fetchone()
        return {**(json.loads(row[0]) if row else {"candidates": []}), "updated_at": row[1] * 1000 if row else None, "revision": job["draft_revision"]}


@router.get("/sources/{source_id}")
def source(source_id: str, request: Request):
    with database.connect() as conn:
        row = conn.execute("SELECT * FROM ingestion_sources WHERE id=? AND learner_id=?", (source_id, learner(request))).fetchone()
        if not row or not Path(row["storage_path"]).is_file():
            raise HTTPException(404, "Source not found")
        return FileResponse(row["storage_path"], media_type=row["mime_type"], filename=row["filename"])


@router.get("/items/{item_id}/sources")
def item_sources(item_id: str, request: Request):
    """Accepted passage citations, with stable authenticated source and preview links."""
    with database.connect() as conn:
        if not conn.execute("SELECT 1 FROM words WHERE id=? AND deleted_at IS NULL", (item_id,)).fetchone():
            raise HTTPException(404, "Item not found")
        rows = conn.execute("""SELECT s.id AS source_id,s.filename,s.mime_type,s.sha256,s.size_bytes,s.created_at,
            c.job_id,c.id AS candidate_id,j.extraction_mode,j.crop_json,i.citations_json
            FROM item_sources i JOIN ingestion_sources s ON s.id=i.source_id
            JOIN ingestion_candidates c ON c.id=i.candidate_id JOIN ingestion_jobs j ON j.id=c.job_id
            WHERE i.item_id=? AND s.learner_id=? AND j.learner_id=?
            ORDER BY s.created_at,c.id""", (item_id, learner(request), learner(request))).fetchall()
        sources = []
        for row in rows:
            entry = dict(row)
            crop_json = entry.pop("crop_json")
            entry["crop"] = json.loads(crop_json) if crop_json else None
            entry["citations"] = json.loads(entry.pop("citations_json"))
            entry["source_path"] = f"/ingestion/sources/{row['source_id']}"
            cited_pages = {c["page_number"] for c in entry["citations"]}
            entry["pages"] = []
            for page_row in conn.execute("SELECT page_number,width,height,method,metadata_json FROM ingestion_pages WHERE job_id=? ORDER BY page_number", (row["job_id"],)):
                if page_row["page_number"] not in cited_pages:
                    continue
                page_data = dict(page_row)
                page_data["metadata"] = json.loads(page_data.pop("metadata_json"))
                page_data["metadata"].pop("raw_parser_output", None)
                page_data["preview_path"] = f"/ingestion/jobs/{row['job_id']}/pages/{page_row['page_number']}/preview" if page_data["metadata"].get("preview_sha256") else None
                entry["pages"].append(page_data)
            sources.append(entry)
        return {"item_id": item_id, "sources": sources}


@router.get("/jobs/{job_id}/pages/{page_number}")
def page(job_id: str, page_number: int, request: Request):
    call(service.get_job, job_id, learner(request))
    with database.connect() as conn:
        row = conn.execute("SELECT * FROM ingestion_pages WHERE job_id=? AND page_number=?", (job_id, page_number)).fetchone()
        if not row:
            raise HTTPException(404, "Page not found")
        result = dict(row)
        result["metadata"] = json.loads(result.pop("metadata_json"))
        result["metadata"].pop("raw_parser_output", None)
        result["blocks"] = [dict(b) for b in conn.execute("SELECT * FROM ingestion_blocks WHERE page_id=? ORDER BY reading_order", (row["id"],))]
        for block in result["blocks"]:
            block["bbox"] = json.loads(block.pop("bbox_json"))
        return result


@router.get("/jobs/{job_id}/pages/{page_number}/preview")
def page_preview(job_id: str, page_number: int, request: Request):
    data = page(job_id, page_number, request)
    digest = data["metadata"].get("preview_sha256", "")
    if len(digest) != 64 or not all(c in "0123456789abcdef" for c in digest):
        raise HTTPException(404, "Preview unavailable")
    path = settings.DATA_DIR / "sources" / digest
    if not path.is_file():
        raise HTTPException(404, "Preview unavailable")
    return FileResponse(path, media_type="image/png")


@router.patch("/jobs/{job_id}/blocks/{block_id}")
def correct_block(job_id: str, block_id: str, body: BlockCorrection, request: Request):
    import time
    learner_id = learner(request)
    operation_id = str(body.operation_id)
    payload = json.dumps({"job_id": job_id, "block_id": block_id, **body.model_dump(mode="json")}, sort_keys=True)
    with database.connect(immediate=True) as conn:
        prior = conn.execute("SELECT * FROM operations WHERE id=?", (operation_id,)).fetchone()
        if prior:
            if prior["learner_id"] != learner_id or prior["kind"] != "source_correction" or prior["payload_json"] != payload:
                raise HTTPException(409, "Source correction operation ID collision")
            return json.loads(prior["response_json"])
        job = conn.execute("SELECT * FROM ingestion_jobs WHERE id=? AND learner_id=?", (job_id, learner_id)).fetchone()
        if not job:
            raise HTTPException(404, "Import not found")
        if job["status"] != "ready" or conn.execute("SELECT 1 FROM ingestion_candidates WHERE job_id=? AND status!='pending'", (job_id,)).fetchone():
            raise HTTPException(409, "Source correction is available before candidate acceptance")
        block = conn.execute("SELECT b.* FROM ingestion_blocks b JOIN ingestion_pages p ON p.id=b.page_id WHERE b.id=? AND p.job_id=?", (block_id, job_id)).fetchone()
        if not block:
            raise HTTPException(404, "Source block not found")
        if block["revision"] != body.expected_revision:
            raise HTTPException(409, "Source block changed; refresh before correcting it")
        revision = block["revision"] + 1
        # Parser stages and every human revision remain distinct immutable facts.
        conn.execute("INSERT INTO ingestion_source_corrections VALUES(?,?,?,?,?,?,?,?,?)", (
            operation_id, learner_id, job_id, block_id, block["revision"], revision,
            block["text"], body.text, database.utcnow()))
        conn.execute("INSERT INTO ingestion_stages VALUES(?,?,'corrected',?,?)", (job_id, f"correction:{block_id}:{revision}", json.dumps({"operation_id": operation_id, "original": block["text"], "corrected": body.text, "revision": revision}), int(time.time())))
        conn.execute("UPDATE ingestion_blocks SET text=?,revision=? WHERE id=?", (body.text, revision, block_id))
        conn.execute("DELETE FROM ingestion_candidates WHERE job_id=?", (job_id,))
        conn.execute("DELETE FROM ingestion_stages WHERE job_id=? AND (stage_key LIKE 'chunk:%' OR stage_key='review-draft')", (job_id,))
        conn.execute("UPDATE ingestion_jobs SET status='queued',stage='queued',control_revision=control_revision+1,draft_revision=draft_revision+1,updated_at=? WHERE id=?", (int(time.time()), job_id))
        service.enqueue(conn, job_id)
        result = service.read_job(conn, job_id, learner_id)
        conn.execute("INSERT INTO operations VALUES(?,?,?,?,?,?)", (operation_id, learner_id, "source_correction", database.utcnow(), payload, json.dumps(result)))
        return result
