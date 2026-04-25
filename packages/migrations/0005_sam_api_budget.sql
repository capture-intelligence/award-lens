-- =================================================================
-- SAM.gov API daily budget tracker (replaces the Durable Object that
-- was Workers-Paid-only). One row per UTC date; atomic increment with
-- ON CONFLICT DO UPDATE WHERE for budget enforcement.
-- =================================================================

CREATE TABLE sam_api_budget (
    date_utc      TEXT PRIMARY KEY,    -- YYYY-MM-DD
    used          INTEGER NOT NULL DEFAULT 0,
    limit_total   INTEGER NOT NULL DEFAULT 10,
    last_call_at  TEXT
);

CREATE INDEX idx_sam_budget_date ON sam_api_budget(date_utc);
