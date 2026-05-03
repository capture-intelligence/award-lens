-- Widen ai_audit.intent CHECK to include 'similar_awards' intent.
-- SQLite doesn't support ALTER TABLE ... DROP CONSTRAINT, so recreate with the updated check.

ALTER TABLE ai_audit RENAME TO ai_audit_old;

CREATE TABLE ai_audit (
  audit_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT    NOT NULL,
  user_id         TEXT    REFERENCES app_user(user_id),
  question_hash   TEXT    NOT NULL,
  intent          TEXT    NOT NULL,
  model           TEXT    NOT NULL,
  model_id        TEXT    NOT NULL,
  prompt_tokens   INTEGER,
  output_tokens   INTEGER,
  duration_ms     INTEGER,
  status          TEXT    NOT NULL,
  error_message   TEXT,
  data_class      TEXT    NOT NULL DEFAULT 'INTERNAL',
  CHECK (model IN ('M1', 'M2', 'M3')),
  CHECK (intent IN ('sql_query', 'similar_awards', 'reasoning_local', 'general')),
  CHECK (status IN ('success', 'error'))
);

INSERT INTO ai_audit SELECT * FROM ai_audit_old;
DROP TABLE ai_audit_old;

CREATE INDEX IF NOT EXISTS idx_ai_audit_user_ts  ON ai_audit(user_id, ts);
CREATE INDEX IF NOT EXISTS idx_ai_audit_model_ts ON ai_audit(model, ts);
