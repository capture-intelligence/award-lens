-- ─────────────────────────────────────────────────────────────────────────
-- Filter model — replaces the view model in PR2
-- ─────────────────────────────────────────────────────────────────────────
--
-- Why two tables, not a rename: PR1 ships dual-write so existing /views
-- traffic keeps working while filter routes come online. After PR2 lands
-- the dashboard cuts over and we drop data_view + view_award + view_access
-- + view_run_request in a follow-up cleanup migration.
--
-- A filter is a saved query-time scope:
--   - same access workflow as views (request → admin grant/deny → granted)
--   - filters_json is the same shape as data_view.filters_json
--   - **no per-filter ingest, no M2M with awards** — query endpoints expand
--     filter_json into SQL WHERE clauses against the full warehouse.

CREATE TABLE IF NOT EXISTS data_filter (
    filter_id     TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT,
    enabled       INTEGER NOT NULL DEFAULT 1,
    filters_json  TEXT NOT NULL,
    created_by    TEXT REFERENCES app_user(user_id),
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_data_filter_enabled ON data_filter(enabled);

-- Per-user access grants — same status enum as view_access for code reuse.
CREATE TABLE IF NOT EXISTS filter_access (
    access_id       TEXT PRIMARY KEY,
    filter_id       TEXT NOT NULL REFERENCES data_filter(filter_id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    status          TEXT NOT NULL CHECK (status IN ('requested','granted','denied','revoked')),
    requested_at    TEXT NOT NULL,
    requested_note  TEXT,
    decided_at      TEXT,
    decided_by      TEXT REFERENCES app_user(user_id),
    decision_note   TEXT,
    UNIQUE (filter_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_filter_access_user        ON filter_access(user_id, status);
CREATE INDEX IF NOT EXISTS idx_filter_access_filter      ON filter_access(filter_id, status);
CREATE INDEX IF NOT EXISTS idx_filter_access_requested   ON filter_access(status, requested_at);

-- ─────────────────────────────────────────────────────────────────────────
-- Backfill from existing views — preserves filter_id == view_id so
-- pre-existing access grants stay valid as filter_access rows.
-- ─────────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO data_filter
    (filter_id, name, description, enabled, filters_json, created_by, created_at, updated_at)
SELECT
    view_id, name, description, enabled, filters_json, created_by, created_at, updated_at
FROM data_view;

INSERT OR IGNORE INTO filter_access
    (access_id, filter_id, user_id, status, requested_at, requested_note, decided_at, decided_by, decision_note)
SELECT
    access_id, view_id, user_id, status, requested_at, requested_note, decided_at, decided_by, decision_note
FROM view_access;
