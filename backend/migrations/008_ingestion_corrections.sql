ALTER TABLE ingestion_blocks ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
CREATE TABLE ingestion_source_corrections (
 id TEXT PRIMARY KEY,
 learner_id TEXT NOT NULL REFERENCES learners(id),
 job_id TEXT NOT NULL REFERENCES ingestion_jobs(id),
 block_id TEXT NOT NULL REFERENCES ingestion_blocks(id),
 before_revision INTEGER NOT NULL,
 after_revision INTEGER NOT NULL,
 original_text TEXT NOT NULL,
 corrected_text TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(block_id,after_revision)
);
CREATE TRIGGER ingestion_source_corrections_no_update
BEFORE UPDATE ON ingestion_source_corrections
BEGIN SELECT RAISE(ABORT,'Source correction history is immutable'); END;
CREATE TRIGGER ingestion_source_corrections_no_delete
BEFORE DELETE ON ingestion_source_corrections
BEGIN SELECT RAISE(ABORT,'Source correction history is immutable'); END;
