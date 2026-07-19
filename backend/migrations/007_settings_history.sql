CREATE TABLE settings_revisions (
 learner_id TEXT NOT NULL REFERENCES learners(id),
 revision INTEGER NOT NULL,
 desired_retention REAL NOT NULL,
 experimental_grading INTEGER NOT NULL,
 progress_generation INTEGER NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(learner_id,revision)
);
INSERT INTO settings_revisions SELECT learner_id,revision,desired_retention,experimental_grading,progress_generation,strftime('%Y-%m-%dT%H:%M:%f+00:00','now') FROM learner_settings;
CREATE TRIGGER settings_revision_insert AFTER UPDATE ON learner_settings WHEN NEW.revision<>OLD.revision BEGIN
 INSERT INTO settings_revisions VALUES(NEW.learner_id,NEW.revision,NEW.desired_retention,NEW.experimental_grading,NEW.progress_generation,strftime('%Y-%m-%dT%H:%M:%f+00:00','now'));
END;
