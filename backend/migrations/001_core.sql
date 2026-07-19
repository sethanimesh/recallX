CREATE TABLE words_v2 (
 id TEXT PRIMARY KEY, word TEXT NOT NULL COLLATE NOCASE,
 definition TEXT NOT NULL, example_sentence TEXT NOT NULL, mnemonic TEXT,
 source_type TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
 sense_id TEXT NOT NULL, content_revision INTEGER NOT NULL DEFAULT 1, etymology TEXT
);
INSERT INTO words_v2(id,word,definition,example_sentence,mnemonic,source_type,created_at,updated_at,deleted_at,sense_id)
 SELECT id,word,definition,example_sentence,mnemonic,source_type,created_at,updated_at,deleted_at,id FROM words;
DROP TABLE words;
ALTER TABLE words_v2 RENAME TO words;
CREATE INDEX words_text_idx ON words(word COLLATE NOCASE);
CREATE TABLE learners(id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
INSERT INTO learners VALUES('personal',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE learner_settings (
 learner_id TEXT PRIMARY KEY REFERENCES learners(id), desired_retention REAL NOT NULL DEFAULT .9 CHECK(desired_retention BETWEEN .7 AND .99),
 experimental_grading INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, progress_generation INTEGER NOT NULL DEFAULT 1
);
INSERT INTO learner_settings(learner_id) VALUES('personal');
CREATE TABLE devices(id TEXT PRIMARY KEY, learner_id TEXT NOT NULL REFERENCES learners(id), name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT);
CREATE TABLE pairing_requests(id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, device_name TEXT NOT NULL, poll_hash TEXT NOT NULL, expires_at TEXT NOT NULL, approved_device_id TEXT REFERENCES devices(id), delivered_at TEXT);
CREATE TABLE app_metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sync_meta(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
INSERT INTO sync_meta VALUES(1,1);
CREATE TABLE parameter_versions (
 id TEXT PRIMARY KEY, learner_id TEXT NOT NULL REFERENCES learners(id), mode TEXT NOT NULL CHECK(mode IN ('recall','flashcard')),
 parameters_json TEXT NOT NULL, algorithm_version TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, activated_at TEXT,
 training_cutoff TEXT, validation_cutoff TEXT, report_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE memory_states (
 learner_id TEXT NOT NULL REFERENCES learners(id), item_id TEXT NOT NULL REFERENCES words(id), mode TEXT NOT NULL CHECK(mode IN ('recall','flashcard')),
 card_id INTEGER NOT NULL UNIQUE, card_json TEXT NOT NULL, state_version INTEGER NOT NULL DEFAULT 0, progress_generation INTEGER NOT NULL,
 parameter_version TEXT NOT NULL REFERENCES parameter_versions(id), updated_at TEXT NOT NULL,
 PRIMARY KEY(learner_id,item_id,mode)
);
CREATE TABLE review_events (
 id TEXT PRIMARY KEY, learner_id TEXT NOT NULL REFERENCES learners(id), item_id TEXT NOT NULL REFERENCES words(id), mode TEXT NOT NULL CHECK(mode IN ('recall','flashcard')),
 assessment_id TEXT, answered_at TEXT NOT NULL, received_at TEXT NOT NULL, device_id TEXT NOT NULL, device_sequence INTEGER NOT NULL,
 rating INTEGER CHECK(rating IN (1,3)), assisted INTEGER NOT NULL, revealed INTEGER NOT NULL, offline INTEGER NOT NULL,
 content_revision INTEGER NOT NULL, progress_generation INTEGER NOT NULL, parameter_version TEXT NOT NULL,
 settings_revision INTEGER NOT NULL, desired_retention REAL NOT NULL, algorithm_version TEXT NOT NULL,
 status TEXT NOT NULL, reason TEXT, experimental INTEGER NOT NULL DEFAULT 0, payload_hash TEXT NOT NULL, response_json TEXT NOT NULL,
 UNIQUE(learner_id,assessment_id)
);
CREATE INDEX review_order ON review_events(learner_id,item_id,mode,answered_at);
CREATE TABLE operations(id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, payload_json TEXT NOT NULL, response_json TEXT NOT NULL);
CREATE TABLE item_revisions(item_id TEXT NOT NULL REFERENCES words(id), revision INTEGER NOT NULL, content_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(item_id,revision));
INSERT INTO item_revisions SELECT id,1,json_object('word',word,'definition',definition,'example_sentence',example_sentence,'mnemonic',mnemonic),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM words;
CREATE TABLE legacy_archives(id TEXT PRIMARY KEY, learner_id TEXT NOT NULL, device_id TEXT NOT NULL, imported_at TEXT NOT NULL, data_json TEXT NOT NULL);
CREATE TABLE review_corrections(id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES review_events(id), learner_id TEXT NOT NULL, rating INTEGER CHECK(rating IN (1,3)), reason TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TRIGGER immutable_review_update BEFORE UPDATE ON review_events BEGIN SELECT RAISE(ABORT,'review events are immutable'); END;
CREATE TRIGGER immutable_review_delete BEFORE DELETE ON review_events BEGIN SELECT RAISE(ABORT,'review events are immutable'); END;
