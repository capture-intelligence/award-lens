-- =================================================================
-- Scoped Views: admin-curated slices of federal award data.
-- Each view is BOTH an ingestion scope (sidecar pulls per-view)
-- AND an access boundary (users request access per-view).
-- =================================================================

-- A "data view" — admins create these. `view` is reserved by SQL
-- (CREATE VIEW), so we prefix.
CREATE TABLE data_view (
    view_id        TEXT PRIMARY KEY,                  -- random UUID
    name           TEXT NOT NULL,                     -- e.g. "CDC / NCHS"
    description    TEXT,
    enabled        INTEGER NOT NULL DEFAULT 1,        -- 1 = active, 0 = paused (no ingest, no user access)

    -- Filter spec — JSON. Schema (all fields optional except as noted by ingest):
    --   {
    --     "toptier_agency_code":  "075",     // HHS toptier code (USAspending)
    --     "subtier_agency_code":  "7523",    // CDC subtier
    --     "office_codes":         ["abc"],   // when USAspending exposes them
    --     "keywords":             ["NCHS"],  // for office-level scoping when API doesn't expose office;
    --                                        // matches awarding_office_name OR description, case-insensitive
    --     "naics_codes":          ["541611","541512"],
    --     "psc_codes":            ["R408"],
    --     "award_types":          ["A","B","C","D"],
    --     "min_value":            100000,
    --     "max_value":            null,
    --     "lookback_months":      24          // pull/show only awards with action_date >= today - 24mo
    --   }
    filters_json   TEXT NOT NULL,

    created_by     TEXT NOT NULL REFERENCES app_user(user_id),
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);

CREATE INDEX idx_data_view_enabled ON data_view(enabled);

-- Many-to-many: which awards belong to which views.
-- Populated by the sidecar at ingest time (or by a back-tag job
-- triggered when an admin edits view filters).
CREATE TABLE view_award (
    view_id    TEXT NOT NULL REFERENCES data_view(view_id) ON DELETE CASCADE,
    award_id   TEXT NOT NULL REFERENCES award(award_id) ON DELETE CASCADE,
    added_at   TEXT NOT NULL,
    PRIMARY KEY (view_id, award_id)
);

CREATE INDEX idx_view_award_award ON view_award(award_id);
CREATE INDEX idx_view_award_view  ON view_award(view_id);

-- Per-view access control. One row per (view, user) pair.
-- User → admin path:
--   user clicks "Request access"  → INSERT status='requested'
--   admin grants                  → UPDATE status='granted', decided_*
--   admin denies                  → UPDATE status='denied',  decided_*
--   admin revokes                 → UPDATE status='revoked', decided_*
CREATE TABLE view_access (
    access_id      TEXT PRIMARY KEY,                  -- random UUID
    view_id        TEXT NOT NULL REFERENCES data_view(view_id) ON DELETE CASCADE,
    user_id        TEXT NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    status         TEXT NOT NULL
        CHECK (status IN ('requested','granted','denied','revoked')),
    requested_at   TEXT NOT NULL,
    requested_note TEXT,
    decided_at     TEXT,
    decided_by     TEXT REFERENCES app_user(user_id),
    decision_note  TEXT,
    UNIQUE (view_id, user_id)
);

CREATE INDEX idx_view_access_user_status ON view_access(user_id, status);
CREATE INDEX idx_view_access_status      ON view_access(status);

-- =================================================================
-- One-time data wipe — design decision (a): start clean.
-- Existing awards were ingested under the old "pull everything"
-- model; new ingestion runs scope per-view. Vendor/organization
-- reference rows survive because they're useful as identity backbone.
-- Exclusions and grant_opportunity are NOT view-scoped (global data).
-- =================================================================

DELETE FROM award_modification;
DELETE FROM award_performance_location;
DELETE FROM award;

-- Free up staging records that pointed at deleted award runs.
DELETE FROM staging_raw_record WHERE source_id = 'usaspending';
-- Keep ingestion_run history for audit.
