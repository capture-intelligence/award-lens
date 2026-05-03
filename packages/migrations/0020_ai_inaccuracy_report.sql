-- User-submitted reports of AI inaccuracies. Each row captures the original
-- question, the actual response shown to the user, the user's description of
-- what's wrong, what they expected, and optional examples — everything
-- needed to investigate, fix, and (eventually) feed back into evaluation.
--
-- Linked to ai_audit when possible so reviewers can correlate with model
-- timings, token usage, and model id. audit_id is nullable because the
-- response shown may have been a synthesized error or a cached state where
-- no audit row was created.
CREATE TABLE IF NOT EXISTS ai_inaccuracy_report (
  report_id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts                     TEXT    NOT NULL,
  user_id                TEXT    REFERENCES app_user(user_id),
  audit_id               INTEGER REFERENCES ai_audit(audit_id),
  intent                 TEXT,                       -- 'sql_query' | 'similar_awards' | 'general' | null
  question               TEXT    NOT NULL,
  actual_response_json   TEXT,                       -- JSON-encoded response object shown to user
  award_context_json     TEXT,                       -- JSON-encoded AiAward, if any
  agency_scope_json      TEXT,                       -- JSON-encoded { awarding_agency, center_code }, if any
  inaccuracy_description TEXT    NOT NULL,           -- what's wrong
  expected_outcome       TEXT    NOT NULL,           -- what the user expected
  examples               TEXT,                       -- optional example(s) of correct behavior
  status                 TEXT    NOT NULL DEFAULT 'open',
  CHECK (status IN ('open', 'reviewed', 'resolved'))
);

CREATE INDEX IF NOT EXISTS idx_ai_inaccuracy_user_ts ON ai_inaccuracy_report(user_id, ts);
CREATE INDEX IF NOT EXISTS idx_ai_inaccuracy_audit   ON ai_inaccuracy_report(audit_id);
CREATE INDEX IF NOT EXISTS idx_ai_inaccuracy_status  ON ai_inaccuracy_report(status, ts);
