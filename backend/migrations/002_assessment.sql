CREATE TABLE IF NOT EXISTS rubrics (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES words(id),
    revision INTEGER NOT NULL CHECK(revision > 0),
    content_revision INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','retired')),
    reference_language TEXT NOT NULL DEFAULT 'en',
    concepts_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    approved_at INTEGER,
    UNIQUE(item_id, revision)
);
CREATE INDEX IF NOT EXISTS rubric_item_revision ON rubrics(item_id, content_revision, revision);
CREATE TABLE IF NOT EXISTS assessments (
    id TEXT PRIMARY KEY,
    learner_id TEXT NOT NULL,
    item_id TEXT NOT NULL REFERENCES words(id),
    content_revision INTEGER NOT NULL,
    rubric_revision INTEGER,
    decision TEXT NOT NULL CHECK(decision IN ('correct','partial','incorrect','uncertain')),
    experimental INTEGER NOT NULL DEFAULT 0,
    assisted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    response_json TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    answer_text TEXT,
    answer_language TEXT NOT NULL DEFAULT 'en',
    raw_expires_at INTEGER,
    UNIQUE(learner_id,id)
);
CREATE INDEX IF NOT EXISTS assessment_item_history ON assessments(learner_id,item_id,created_at);
DELETE FROM system_prompts WHERE id IN ('grade','tutor');
