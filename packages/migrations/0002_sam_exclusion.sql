-- =================================================================
-- SAM.gov exclusion records (debarred / suspended parties)
-- Source: SAM.gov Exclusions Public Extract (daily ZIP, no API key)
-- =================================================================

CREATE TABLE sam_exclusion (
    exclusion_id      TEXT PRIMARY KEY,       -- hash(uei or name + active_date + ct_code)
    source_row_id     TEXT,                   -- SAM's own ExclusionID if present
    uei               TEXT,
    duns              TEXT,
    cage_code         TEXT,
    legal_name        TEXT NOT NULL,
    classification    TEXT,                   -- 'Firm','Individual','Special Entity Designation','Vessel'
    exclusion_type    TEXT,                   -- 'Debarment','Suspension','Proposed Debarment','Reciprocal'
    ct_code           TEXT,                   -- cause & treatment code (e.g., 'S','Z')
    is_active         INTEGER NOT NULL DEFAULT 1,
    active_date       TEXT,                   -- ISO date — excluded on
    termination_date  TEXT,                   -- ISO date — future or null if indefinite
    excluding_agency  TEXT,
    reason            TEXT,
    country_code      TEXT,
    state             TEXT,
    city              TEXT,
    address_line      TEXT,
    zip               TEXT,
    extract_date      TEXT NOT NULL,          -- date the source extract was generated
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

CREATE INDEX idx_sam_excl_uei        ON sam_exclusion(uei);
CREATE INDEX idx_sam_excl_name       ON sam_exclusion(legal_name);
CREATE INDEX idx_sam_excl_active     ON sam_exclusion(is_active);
CREATE INDEX idx_sam_excl_termdate   ON sam_exclusion(termination_date);
CREATE INDEX idx_sam_excl_extract    ON sam_exclusion(extract_date);

-- Link vendors we already know about to any exclusion hit.
-- Populated opportunistically during bulk ingest when uei matches.
CREATE VIEW v_vendor_exclusion_status AS
SELECT
    v.vendor_id,
    v.uei,
    v.legal_name,
    CASE WHEN EXISTS (
      SELECT 1 FROM sam_exclusion e
      WHERE (e.uei = v.uei OR e.legal_name = v.legal_name)
        AND e.is_active = 1
        AND (e.termination_date IS NULL OR date(e.termination_date) >= date('now'))
    ) THEN 1 ELSE 0 END AS is_currently_excluded,
    (SELECT MAX(e.active_date) FROM sam_exclusion e
       WHERE (e.uei = v.uei OR e.legal_name = v.legal_name)
         AND e.is_active = 1
    ) AS latest_exclusion_date
FROM vendor v;
