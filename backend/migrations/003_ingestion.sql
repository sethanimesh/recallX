CREATE TABLE IF NOT EXISTS ingestion_sources (
 id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, sha256 TEXT NOT NULL,
 filename TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
 storage_path TEXT NOT NULL, crop_json TEXT, created_at INTEGER NOT NULL,
 UNIQUE(learner_id, sha256)
);
CREATE TABLE IF NOT EXISTS ingestion_jobs (
 id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES ingestion_sources(id),
 request_id TEXT NOT NULL, request_hash TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'queued', stage TEXT NOT NULL DEFAULT 'queued',
 pages_total INTEGER NOT NULL DEFAULT 0, pages_done INTEGER NOT NULL DEFAULT 0,
 error_code TEXT, error_message TEXT, lease_token TEXT, lease_until INTEGER,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(learner_id,request_id)
);
CREATE TABLE IF NOT EXISTS ingestion_pages (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES ingestion_jobs(id) ON DELETE CASCADE,
 page_number INTEGER NOT NULL, width REAL NOT NULL, height REAL NOT NULL,
 method TEXT NOT NULL, metadata_json TEXT NOT NULL, UNIQUE(job_id,page_number)
);
CREATE TABLE IF NOT EXISTS ingestion_blocks (
 id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES ingestion_pages(id) ON DELETE CASCADE,
 reading_order INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL,
 bbox_json TEXT NOT NULL, confidence REAL, UNIQUE(page_id,reading_order)
);
CREATE TABLE IF NOT EXISTS ingestion_stages (
 job_id TEXT NOT NULL REFERENCES ingestion_jobs(id) ON DELETE CASCADE,
 stage_key TEXT NOT NULL, status TEXT NOT NULL, result_json TEXT,
 updated_at INTEGER NOT NULL, PRIMARY KEY(job_id,stage_key)
);
CREATE TABLE IF NOT EXISTS ingestion_outbox (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES ingestion_jobs(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL, dispatched_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ingestion_outbox_pending ON ingestion_outbox(dispatched_at);
CREATE TABLE IF NOT EXISTS ingestion_candidates (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES ingestion_jobs(id) ON DELETE CASCADE,
 word TEXT NOT NULL, definition TEXT NOT NULL, example_sentence TEXT NOT NULL,
 mnemonic TEXT, etymology TEXT, citations_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', item_id TEXT REFERENCES words(id),
 UNIQUE(job_id,id)
);
CREATE TABLE IF NOT EXISTS item_sources (
 item_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
 candidate_id TEXT NOT NULL REFERENCES ingestion_candidates(id),
 source_id TEXT NOT NULL REFERENCES ingestion_sources(id), citations_json TEXT NOT NULL,
 PRIMARY KEY(item_id,candidate_id)
);
CREATE TABLE IF NOT EXISTS ingestion_approval_requests (
 learner_id TEXT NOT NULL, request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
 result_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(learner_id,request_id)
);
