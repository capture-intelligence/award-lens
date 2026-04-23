-- =================================================================
-- Federal Awards Warehouse — initial schema (D1 / SQLite)
-- Generic, source-agnostic model that fits USAspending, SAM.gov,
-- Grants.gov, FPDS, and any other federal contracting data source.
-- =================================================================

PRAGMA foreign_keys = ON;

-- ============ PLATFORM / AUDIT ============

CREATE TABLE source_system (
    source_id     TEXT PRIMARY KEY,
    display_name  TEXT NOT NULL,
    base_url      TEXT NOT NULL,
    auth_type     TEXT,
    is_active     INTEGER NOT NULL DEFAULT 1
);

INSERT INTO source_system (source_id, display_name, base_url, auth_type) VALUES
  ('usaspending', 'USAspending.gov',       'https://api.usaspending.gov/api/v2', 'none'),
  ('sam_bulk',    'SAM.gov Public Extract','https://sam.gov/data-services',      'none'),
  ('sam_api',     'SAM.gov API',           'https://api.sam.gov',                'api_key'),
  ('grants_gov',  'Grants.gov',            'https://api.grants.gov/v1/api',      'none');

CREATE TABLE ingestion_run (
    run_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id        TEXT NOT NULL REFERENCES source_system(source_id),
    started_at       TEXT NOT NULL,
    finished_at      TEXT,
    status           TEXT NOT NULL CHECK (status IN ('running','success','partial','failed')),
    watermark_before TEXT,
    watermark_after  TEXT,
    rows_fetched     INTEGER NOT NULL DEFAULT 0,
    rows_upserted    INTEGER NOT NULL DEFAULT 0,
    rows_failed      INTEGER NOT NULL DEFAULT 0,
    error_summary    TEXT
);

CREATE INDEX idx_run_source_time ON ingestion_run(source_id, started_at DESC);

CREATE TABLE staging_raw_record (
    staging_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          INTEGER NOT NULL REFERENCES ingestion_run(run_id),
    source_id       TEXT NOT NULL,
    endpoint        TEXT NOT NULL,
    request_params  TEXT,
    response_hash   TEXT NOT NULL,
    r2_key          TEXT NOT NULL,
    fetched_at      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','parsed','failed')),
    failure_reason  TEXT,
    UNIQUE (source_id, response_hash)
);

CREATE INDEX idx_staging_status ON staging_raw_record(status);
CREATE INDEX idx_staging_run    ON staging_raw_record(run_id);

CREATE TABLE external_id_mapping (
    source_id      TEXT NOT NULL,
    external_id    TEXT NOT NULL,
    entity_type    TEXT NOT NULL CHECK (entity_type IN ('award','vendor','organization','office')),
    internal_id    TEXT NOT NULL,
    first_seen_at  TEXT NOT NULL,
    last_seen_at   TEXT NOT NULL,
    PRIMARY KEY (source_id, external_id, entity_type)
);

CREATE INDEX idx_extmap_internal ON external_id_mapping(internal_id, entity_type);

-- ============ REFERENCE DATA (global) ============

CREATE TABLE naics_code (
    naics_code   TEXT PRIMARY KEY,
    description  TEXT NOT NULL,
    year_edition INTEGER
);

CREATE TABLE psc_code (
    psc_code     TEXT PRIMARY KEY,
    description  TEXT NOT NULL,
    category     TEXT
);

CREATE TABLE country (
    country_code TEXT PRIMARY KEY,
    name         TEXT NOT NULL
);

-- ============ CORE ENTITIES ============

CREATE TABLE organization (
    org_id            TEXT PRIMARY KEY,
    parent_org_id     TEXT REFERENCES organization(org_id),
    org_type          TEXT NOT NULL,
    canonical_name    TEXT NOT NULL,
    short_name        TEXT,
    acronym           TEXT,
    country_code      TEXT REFERENCES country(country_code),
    external_ids_json TEXT,
    is_stub           INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

CREATE INDEX idx_org_parent ON organization(parent_org_id);
CREATE INDEX idx_org_name   ON organization(canonical_name);

CREATE TABLE organization_alias (
    alias_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id      TEXT NOT NULL REFERENCES organization(org_id),
    alias       TEXT NOT NULL,
    alias_type  TEXT
);

CREATE TABLE vendor (
    vendor_id        TEXT PRIMARY KEY,
    uei              TEXT UNIQUE,
    duns             TEXT,
    cage_code        TEXT,
    legal_name       TEXT NOT NULL,
    common_name      TEXT,
    country_code     TEXT,
    state            TEXT,
    city             TEXT,
    zip              TEXT,
    primary_naics    TEXT REFERENCES naics_code(naics_code),
    parent_vendor_id TEXT REFERENCES vendor(vendor_id),
    is_stub          INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE INDEX idx_vendor_uei        ON vendor(uei);
CREATE INDEX idx_vendor_legal_name ON vendor(legal_name);
CREATE INDEX idx_vendor_state      ON vendor(state);

CREATE TABLE vendor_classification (
    vendor_id       TEXT NOT NULL REFERENCES vendor(vendor_id),
    classification  TEXT NOT NULL,
    effective_from  TEXT,
    effective_to    TEXT,
    source_id       TEXT REFERENCES source_system(source_id),
    -- D1/SQLite doesn't allow expressions in PRIMARY KEY constraints.
    -- We only track one row per (vendor, classification); the effective_from
    -- column is informational and updated in place when the classification
    -- is re-observed.
    PRIMARY KEY (vendor_id, classification)
);

CREATE TABLE contracting_office (
    office_id        TEXT PRIMARY KEY,
    org_id           TEXT REFERENCES organization(org_id),
    fpds_office_code TEXT UNIQUE,
    name             TEXT NOT NULL
);

-- ============ AWARDS ============

CREATE TABLE award (
    award_id             TEXT PRIMARY KEY,
    award_piid           TEXT,
    parent_piid          TEXT,
    award_type           TEXT,
    vendor_id            TEXT REFERENCES vendor(vendor_id),
    awarding_org_id      TEXT REFERENCES organization(org_id),
    funding_org_id       TEXT REFERENCES organization(org_id),
    awarding_office_id   TEXT REFERENCES contracting_office(office_id),
    funding_office_id    TEXT REFERENCES contracting_office(office_id),
    naics_code           TEXT REFERENCES naics_code(naics_code),
    psc_code             TEXT REFERENCES psc_code(psc_code),
    description          TEXT,
    base_value           REAL,
    current_value        REAL,
    obligated_amount     REAL,
    currency_code        TEXT NOT NULL DEFAULT 'USD',
    pop_start_date       TEXT,
    pop_end_date         TEXT,
    solicitation_id      TEXT,
    source_last_modified TEXT NOT NULL,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL
);

CREATE INDEX idx_award_piid             ON award(award_piid);
CREATE INDEX idx_award_vendor           ON award(vendor_id);
CREATE INDEX idx_award_awarding_org     ON award(awarding_org_id);
CREATE INDEX idx_award_pop_end          ON award(pop_end_date);
CREATE INDEX idx_award_source_modified  ON award(source_last_modified);
CREATE INDEX idx_award_current_value    ON award(current_value DESC);

CREATE TABLE award_modification (
    mod_id           TEXT PRIMARY KEY,
    award_id         TEXT NOT NULL REFERENCES award(award_id),
    mod_number       TEXT,
    action_date      TEXT NOT NULL,
    action_type      TEXT,
    obligation_delta REAL,
    new_total_value  REAL,
    reason_code      TEXT,
    source_id        TEXT NOT NULL,
    source_tx_id     TEXT NOT NULL,
    UNIQUE (source_id, source_tx_id)
);

CREATE INDEX idx_mod_award ON award_modification(award_id, action_date);

CREATE TABLE award_performance_location (
    award_id               TEXT PRIMARY KEY REFERENCES award(award_id),
    country_code           TEXT,
    state                  TEXT,
    city                   TEXT,
    zip                    TEXT,
    congressional_district TEXT
);

-- ============ TAXONOMY (generic tagging) ============

CREATE TABLE taxonomy (
    taxonomy_id    TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    description    TEXT,
    owner_org_id   TEXT REFERENCES organization(org_id),
    is_hierarchical INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE taxonomy_term (
    term_id        TEXT PRIMARY KEY,
    taxonomy_id    TEXT NOT NULL REFERENCES taxonomy(taxonomy_id),
    parent_term_id TEXT REFERENCES taxonomy_term(term_id),
    code           TEXT,
    label          TEXT NOT NULL,
    description    TEXT,
    sort_order     INTEGER,
    is_active      INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_term_tax ON taxonomy_term(taxonomy_id);

CREATE TABLE entity_tag (
    tag_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type  TEXT NOT NULL,
    entity_id    TEXT NOT NULL,
    term_id      TEXT NOT NULL REFERENCES taxonomy_term(term_id),
    assigned_at  TEXT NOT NULL,
    confidence   REAL,
    source_note  TEXT
);

CREATE INDEX idx_entity_tag_lookup ON entity_tag(entity_type, entity_id);
CREATE INDEX idx_entity_tag_term   ON entity_tag(term_id);

-- ============ ANALYTICAL VIEWS ============

CREATE VIEW v_award_current AS
SELECT
    a.award_id,
    a.award_piid,
    a.award_type,
    a.description,
    a.current_value,
    a.obligated_amount,
    a.pop_start_date,
    a.pop_end_date,
    a.naics_code,
    a.psc_code,
    v.vendor_id,
    v.legal_name AS vendor_name,
    v.uei        AS vendor_uei,
    v.state      AS vendor_state,
    o.canonical_name AS awarding_org_name,
    CAST(julianday(a.pop_end_date) - julianday('now') AS INTEGER) AS days_to_expiry
FROM award a
LEFT JOIN vendor v       ON v.vendor_id = a.vendor_id
LEFT JOIN organization o ON o.org_id    = a.awarding_org_id;

CREATE VIEW v_expiring_18_months AS
SELECT *
FROM v_award_current
WHERE pop_end_date IS NOT NULL
  AND date(pop_end_date) BETWEEN date('now') AND date('now', '+18 months');

CREATE VIEW v_vendor_rollup AS
SELECT
    v.vendor_id,
    v.uei,
    v.legal_name,
    COUNT(a.award_id)                   AS num_awards,
    COALESCE(SUM(a.current_value), 0)   AS total_value,
    MIN(a.pop_start_date)               AS first_award_date,
    MAX(a.pop_end_date)                 AS last_pop_end
FROM vendor v
LEFT JOIN award a ON a.vendor_id = v.vendor_id
GROUP BY v.vendor_id, v.uei, v.legal_name;
