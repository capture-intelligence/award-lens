-- AI audit log — one row per model call, no raw text stored.
-- See docs/architecture/MODEL-ROUTING.md §4 for the full policy.
CREATE TABLE IF NOT EXISTS ai_audit (
  audit_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT    NOT NULL,
  user_id         TEXT    REFERENCES app_user(user_id),
  question_hash   TEXT    NOT NULL,   -- sha256 hex of question text
  intent          TEXT    NOT NULL,   -- 'sql_query'|'reasoning_local'|'general'
  model           TEXT    NOT NULL,   -- 'M1'|'M2'|'M3'
  model_id        TEXT    NOT NULL,   -- full model string used
  prompt_tokens   INTEGER,
  output_tokens   INTEGER,
  duration_ms     INTEGER,
  status          TEXT    NOT NULL,   -- 'success'|'error'
  error_message   TEXT,
  data_class      TEXT    NOT NULL DEFAULT 'INTERNAL',
  CHECK (model IN ('M1', 'M2', 'M3')),
  CHECK (intent IN ('sql_query', 'reasoning_local', 'general')),
  CHECK (status IN ('success', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_user_ts  ON ai_audit(user_id, ts);
CREATE INDEX IF NOT EXISTS idx_ai_audit_model_ts ON ai_audit(model, ts);
