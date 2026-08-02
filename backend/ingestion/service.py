import hashlib
import json
import time
import uuid

import database
from ingestion.models import Approval, Crop, JobMutation
from ingestion.storage import inspect_asset, store_asset


class IngestionError(ValueError):
    def __init__(self, message, status=409):
        super().__init__(message)
        self.status = status


def stable_hash(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def enqueue(conn, job_id):
    conn.execute("INSERT INTO ingestion_outbox(id,job_id,created_at) VALUES(?,?,?)", (str(uuid.uuid4()), job_id, int(time.time())))


def submit(data: bytes, filename: str, mime: str, request_id: str, instructions: str, crop: Crop | None, learner_id="personal", extraction_mode="general_document"):
    actual_mime, pages = inspect_asset(data, mime)
    if crop and actual_mime == "application/pdf":
        raise IngestionError("PDF uploads cannot include an image crop", 422)
    digest, storage = store_asset(data)
    crop_data = crop.model_dump() if crop else None
    if extraction_mode not in {"general_document", "vocabulary_mcq"}:
        raise IngestionError("Unknown extraction mode", 422)
    fingerprint = stable_hash([digest, instructions, crop_data, extraction_mode])
    now = int(time.time())
    with database.connect(immediate=True) as conn:
        existing = conn.execute("SELECT id,request_hash FROM ingestion_jobs WHERE learner_id=? AND request_id=?", (learner_id, request_id)).fetchone()
        if existing:
            if existing["request_hash"] != fingerprint:
                raise IngestionError("Upload request ID was already used for different content")
            job_id = existing["id"]
        else:
            source = conn.execute("SELECT id FROM ingestion_sources WHERE learner_id=? AND sha256=?", (learner_id, digest)).fetchone()
            source_id = source["id"] if source else str(uuid.uuid4())
            if not source:
                conn.execute("INSERT INTO ingestion_sources(id,learner_id,sha256,filename,mime_type,size_bytes,storage_path,created_at) VALUES(?,?,?,?,?,?,?,?)", (source_id, learner_id, digest, filename[:255], actual_mime, len(data), storage, now))
            job_id = str(uuid.uuid4())
            conn.execute("INSERT INTO ingestion_jobs(id,learner_id,source_id,request_id,request_hash,instructions,pages_total,created_at,updated_at,crop_json,extraction_mode) VALUES(?,?,?,?,?,?,?,?,?,?,?)", (job_id, learner_id, source_id, request_id, fingerprint, instructions, pages, now, now, json.dumps(crop_data) if crop_data else None, extraction_mode))
            enqueue(conn, job_id)
    return get_job(job_id, learner_id)


def get_job(job_id, learner_id="personal"):
    with database.connect() as conn:
        return read_job(conn, job_id, learner_id)


def read_job(conn, job_id, learner_id="personal"):
    """Read inside a caller's transaction when persisting an exact acknowledgement."""
    row = conn.execute("SELECT j.*,s.filename,s.mime_type,s.sha256 FROM ingestion_jobs j JOIN ingestion_sources s ON s.id=j.source_id WHERE j.id=? AND j.learner_id=?", (job_id, learner_id)).fetchone()
    if not row:
        raise IngestionError("Ingestion job not found", 404)
    data = dict(row)
    for key in ("request_hash", "lease_token", "lease_until"):
        data.pop(key, None)
    data["candidates"] = []
    for candidate in conn.execute("SELECT * FROM ingestion_candidates WHERE job_id=? ORDER BY rowid", (job_id,)):
        c = dict(candidate)
        c["citations"] = json.loads(c.pop("citations_json"))
        data["candidates"].append(c)
    data["stages"] = [dict(r) for r in conn.execute("SELECT stage_key,status,updated_at FROM ingestion_stages WHERE job_id=? ORDER BY stage_key", (job_id,))]
    return data


def list_jobs(learner_id="personal"):
    with database.connect() as conn:
        return [dict(row) for row in conn.execute("SELECT j.id,j.status,j.stage,j.pages_done,j.pages_total,j.created_at,j.error_message,j.control_revision,s.filename FROM ingestion_jobs j JOIN ingestion_sources s ON s.id=j.source_id WHERE j.learner_id=? ORDER BY j.created_at DESC LIMIT 100", (learner_id,))]


def cancel(job_id, learner_id="personal", operation: JobMutation | None = None):
    return control_job(job_id, "cancel", learner_id, operation)


def retry(job_id, learner_id="personal", operation: JobMutation | None = None):
    return control_job(job_id, "retry", learner_id, operation)


def control_job(job_id, action, learner_id, operation):
    with database.connect(immediate=True) as conn:
        row = conn.execute("SELECT status,control_revision FROM ingestion_jobs WHERE id=? AND learner_id=?", (job_id, learner_id)).fetchone()
        if not row:
            raise IngestionError("Ingestion job not found", 404)
        # Internal callers still receive recorded operations; HTTP callers must supply theirs.
        operation = operation or JobMutation(operation_id=uuid.uuid4(), expected_revision=row["control_revision"])
        operation_id = str(operation.operation_id)
        payload = json.dumps({"job_id": job_id, **operation.model_dump(mode="json")}, sort_keys=True)
        kind = f"ingestion_{action}"
        prior = conn.execute("SELECT * FROM operations WHERE id=?", (operation_id,)).fetchone()
        if prior:
            if prior["learner_id"] != learner_id or prior["kind"] != kind or prior["payload_json"] != payload:
                raise IngestionError("Import control operation ID collision")
            return json.loads(prior["response_json"])
        if operation.expected_revision != row["control_revision"]:
            raise IngestionError("Import controls changed; refresh before changing this job")
        if action == "cancel":
            if row["status"] == "completed":
                raise IngestionError("Accepted imports cannot be cancelled")
            conn.execute("UPDATE ingestion_jobs SET status='cancelled',stage='cancelled',lease_token=NULL,lease_until=NULL,control_revision=control_revision+1,updated_at=? WHERE id=?", (int(time.time()), job_id))
        else:
            if row["status"] not in {"failed", "cancelled"}:
                raise IngestionError("Only failed or cancelled jobs can be resumed")
            conn.execute("UPDATE ingestion_jobs SET status='queued',stage='queued',error_code=NULL,error_message=NULL,lease_token=NULL,lease_until=NULL,control_revision=control_revision+1,updated_at=? WHERE id=?", (int(time.time()), job_id))
            enqueue(conn, job_id)
        result = read_job(conn, job_id, learner_id)
        conn.execute("INSERT INTO operations VALUES(?,?,?,?,?,?)", (operation_id, learner_id, kind, database.utcnow(), payload, json.dumps(result)))
        return result


def approve(job_id: str, approval: Approval, learner_id="personal"):
    from assessment.rubrics import create_draft
    from services.scheduling import ensure_cards
    fingerprint = stable_hash([job_id, approval.model_dump()])
    now = int(time.time() * 1000)
    with database.connect(immediate=True) as conn:
        prior = conn.execute("SELECT * FROM ingestion_approval_requests WHERE learner_id=? AND request_id=?", (learner_id, approval.request_id)).fetchone()
        if prior:
            if prior["request_hash"] != fingerprint:
                raise IngestionError("Approval request ID was already used for different decisions")
            return json.loads(prior["result_json"])
        job = conn.execute("SELECT * FROM ingestion_jobs WHERE id=? AND learner_id=?", (job_id, learner_id)).fetchone()
        if not job:
            raise IngestionError("Ingestion job not found", 404)
        if job["status"] != "ready":
            raise IngestionError("This import is not ready for review")
        if approval.expected_draft_revision is not None and approval.expected_draft_revision != job["draft_revision"]:
            raise IngestionError("Import draft changed; refresh before approving it")
        candidate_ids = [c.id for c in approval.candidates]
        if len(candidate_ids) != len(set(candidate_ids)):
            raise IngestionError("Duplicate candidate decision", 422)
        result = []
        for decision in approval.candidates:
            if not decision.reviewed:
                raise IngestionError("Review every submitted candidate before approving", 422)
            candidate = conn.execute("SELECT * FROM ingestion_candidates WHERE id=? AND job_id=?", (decision.id, job_id)).fetchone()
            if not candidate:
                raise IngestionError("Candidate does not belong to this import", 422)
            if candidate["status"] != "pending":
                raise IngestionError("Candidate was already reviewed; refresh the import")
            item_id, is_new = None, False
            if decision.accept:
                word, definition = decision.word.strip(), decision.definition.strip()
                if not word or not definition:
                    raise IngestionError("Accepted words require a word and definition", 422)
                existing = conn.execute("SELECT id FROM words WHERE word=? COLLATE NOCASE AND definition=? AND deleted_at IS NULL", (word, definition)).fetchone()
                item_id = existing["id"] if existing else str(uuid.uuid4())
                is_new = existing is None
                if is_new:
                    conn.execute("INSERT INTO words(id,word,definition,example_sentence,mnemonic,source_type,created_at,updated_at,sense_id,content_revision,etymology) VALUES(?,?,?,?,?,'document',?,?,?,1,?)", (item_id, word, definition, decision.example_sentence, decision.mnemonic, now, now, str(uuid.uuid4()), decision.etymology))
                    create_draft(conn, item_id, definition, reference_language=decision.reference_language, content_revision=1)
                    ensure_cards(conn, item_id, learner_id)
                    conn.execute("INSERT INTO item_revisions(item_id,revision,content_json,created_at) VALUES(?,1,?,?)", (item_id, json.dumps(decision.model_dump()), database.utcnow()))
                for tag_id in set(decision.tag_ids):
                    if not conn.execute("SELECT 1 FROM tags WHERE id=?", (tag_id,)).fetchone():
                        raise IngestionError("A selected tag no longer exists", 422)
                    conn.execute("INSERT OR IGNORE INTO word_tags(word_id,tag_id) VALUES(?,?)", (item_id, tag_id))
                conn.execute("INSERT OR IGNORE INTO item_sources(item_id,candidate_id,source_id,citations_json) VALUES(?,?,?,?)", (item_id, decision.id, job["source_id"], candidate["citations_json"]))
            conn.execute("UPDATE ingestion_candidates SET status=?,item_id=?,word=?,definition=?,example_sentence=?,mnemonic=?,etymology=? WHERE id=?", ("accepted" if decision.accept else "rejected", item_id, decision.word.strip(), decision.definition.strip(), decision.example_sentence, decision.mnemonic, decision.etymology, decision.id))
            result.append({"candidate_id": decision.id, "item_id": item_id, "is_new": is_new, "accepted": decision.accept})
        pending = conn.execute("SELECT COUNT(*) FROM ingestion_candidates WHERE job_id=? AND status='pending'", (job_id,)).fetchone()[0]
        if not pending:
            conn.execute("UPDATE ingestion_jobs SET status='completed',stage='completed',updated_at=? WHERE id=?", (int(time.time()), job_id))
        response = {"items": result, "remaining": pending}
        conn.execute("INSERT INTO ingestion_approval_requests VALUES(?,?,?,?,?)", (learner_id, approval.request_id, fingerprint, json.dumps(response), int(time.time())))
        return response
