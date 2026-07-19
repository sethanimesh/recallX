ALTER TABLE ingestion_jobs ADD COLUMN control_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ingestion_jobs ADD COLUMN draft_revision INTEGER NOT NULL DEFAULT 0;
