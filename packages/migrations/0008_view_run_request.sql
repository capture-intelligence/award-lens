-- =================================================================
-- Per-view "Run now" requests with exponential-backoff retries.
--
-- Admin clicks "Run now" on a view  → INSERT row, status='pending'
-- Sidecar trigger timer polls every 60s →
--   1. Selects up to N pending rows whose next_attempt_at <= now
--   2. Claims each row (status='running')
--   3. Ingests the view's USAspending pull
--   4. Reports back:
--        success  → status='success', finished_at = now
--        failure  → if attempt < MAX_ATTEMPTS:
--                     status='pending', next_attempt_at = now + 2^(attempt-1) min
--                   else:
--                     status='failed', finished_at = now
-- =================================================================

CREATE TABLE view_run_request (
    request_id      TEXT PRIMARY KEY,                 -- random UUID
    view_id         TEXT NOT NULL REFERENCES data_view(view_id) ON DELETE CASCADE,

    requested_by    TEXT NOT NULL REFERENCES app_user(user_id),
    requested_at    TEXT NOT NULL,
    requested_note  TEXT,

    status          TEXT NOT NULL
        CHECK (status IN ('pending', 'running', 'success', 'failed')),

    -- Retry plumbing.
    attempt         INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 5,
    next_attempt_at TEXT NOT NULL,                    -- when the sidecar may pick this up

    -- Lifecycle timestamps.
    started_at      TEXT,
    finished_at     TEXT,

    -- Outcome metadata.
    run_id          INTEGER REFERENCES ingestion_run(run_id),  -- the ingestion_run created
    error_message   TEXT
);

-- Sidecar polls on (status, next_attempt_at) every minute.
CREATE INDEX idx_view_run_request_pickup
  ON view_run_request(status, next_attempt_at)
  WHERE status = 'pending';

-- Admin UI fetches per-view to show current state.
CREATE INDEX idx_view_run_request_view
  ON view_run_request(view_id, requested_at DESC);
