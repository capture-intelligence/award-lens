-- =================================================================
-- Grant opportunities (Grants.gov) + reconciliation audit table
-- =================================================================

CREATE TABLE grant_opportunity (
    opportunity_id       TEXT PRIMARY KEY,      -- Grants.gov oppId (stable)
    opportunity_number   TEXT,                   -- human-readable FOA number
    title                TEXT NOT NULL,
    agency_code          TEXT,                   -- 'HHS-CDC','NSF-EDU',...
    agency_name          TEXT,
    category             TEXT,                   -- D=Discretionary, M=Mandatory, ...
    funding_instrument   TEXT,                   -- G=Grant, CA=Cooperative Agreement, ...
    assistance_listings  TEXT,                   -- comma-separated CFDAs (e.g., '93.067,93.946')
    posted_date          TEXT,
    close_date           TEXT,
    archive_date          TEXT,
    est_total_funding    REAL,
    award_ceiling        REAL,
    award_floor          REAL,
    expected_awards      INTEGER,
    eligibility_codes    TEXT,                   -- comma-separated codes
    description          TEXT,
    status               TEXT,                   -- 'posted','forecasted','archived','closed'
    opportunity_url      TEXT,
    doc_type             TEXT,                   -- 'synopsis','forecast'
    extract_date         TEXT NOT NULL,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL
);

CREATE INDEX idx_opp_status        ON grant_opportunity(status);
CREATE INDEX idx_opp_close_date    ON grant_opportunity(close_date);
CREATE INDEX idx_opp_posted_date   ON grant_opportunity(posted_date);
CREATE INDEX idx_opp_agency        ON grant_opportunity(agency_code);
CREATE INDEX idx_opp_number        ON grant_opportunity(opportunity_number);

CREATE VIEW v_active_opportunities AS
SELECT *
FROM grant_opportunity
WHERE status IN ('posted','forecasted')
  AND (close_date IS NULL OR date(close_date) >= date('now'));

-- =================================================================
-- Reconciliation audit
-- =================================================================

CREATE TABLE reconciliation_check (
    check_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id           INTEGER REFERENCES ingestion_run(run_id),
    check_date       TEXT NOT NULL,
    dimension_type   TEXT NOT NULL,            -- 'agency','fiscal_year','naics','source_total'
    dimension_value  TEXT NOT NULL,
    fiscal_year      INTEGER,
    warehouse_total  REAL,
    warehouse_count  INTEGER,
    source_total     REAL,
    source_count     INTEGER,
    drift_abs        REAL,                      -- source_total - warehouse_total
    drift_pct        REAL,                      -- normalized to source_total
    status           TEXT NOT NULL,             -- 'ok','drift','error','no_data'
    notes            TEXT,
    created_at       TEXT NOT NULL
);

CREATE INDEX idx_recon_check_date    ON reconciliation_check(check_date DESC);
CREATE INDEX idx_recon_dim           ON reconciliation_check(dimension_type, dimension_value);
CREATE INDEX idx_recon_status        ON reconciliation_check(status);

-- Latest reconciliation per dimension — for dashboard
CREATE VIEW v_reconciliation_latest AS
SELECT rc.*
FROM reconciliation_check rc
JOIN (
    SELECT dimension_type, dimension_value, fiscal_year, MAX(check_date) AS latest
    FROM reconciliation_check
    GROUP BY dimension_type, dimension_value, fiscal_year
) latest
  ON rc.dimension_type  = latest.dimension_type
 AND rc.dimension_value = latest.dimension_value
 AND COALESCE(rc.fiscal_year, -1) = COALESCE(latest.fiscal_year, -1)
 AND rc.check_date       = latest.latest;

-- =================================================================
-- Register the new source
-- =================================================================
INSERT OR IGNORE INTO source_system (source_id, display_name, base_url, auth_type) VALUES
  ('reconciliation', 'Reconciliation Checks', '(internal)', 'none');
