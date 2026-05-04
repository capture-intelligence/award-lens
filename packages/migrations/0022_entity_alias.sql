-- Precomputed alias / abbreviation lookup so M1 can resolve user-typed
-- short forms ("RTI", "BAH", "CDC", "NCHHSTP") to canonical warehouse
-- entities without doing fuzzy LIKE matches at query time.
--
-- Populated by POST /ai/build-aliases, which sweeps vendor / organization /
-- cdc_center, sends batches to Claude with a prompt that asks for likely
-- user-typed abbreviations, and inserts the result here. Re-runnable —
-- the unique index keeps duplicates out, and re-runs only add new aliases.
CREATE TABLE IF NOT EXISTS entity_alias (
  alias_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  alias           TEXT    NOT NULL,                -- 'RTI', 'NCHHSTP', 'BAH', 'CDC'
  alias_lower     TEXT    NOT NULL,                -- lowercased for case-insensitive lookup
  entity_kind     TEXT    NOT NULL,                -- 'vendor' | 'organization' | 'center'
  canonical_id    TEXT,                            -- vendor_id / org_id / center_code (entity_kind dependent)
  canonical_name  TEXT    NOT NULL,                -- "RESEARCH TRIANGLE INSTITUTE" / "NCHHSTP" / etc.
  source          TEXT    NOT NULL DEFAULT 'claude',
  created_at      TEXT    NOT NULL,
  CHECK (entity_kind IN ('vendor', 'organization', 'center'))
);

-- Lookup index — alias_lower + entity_kind is the hot path during chat
-- entity resolution. UNIQUE keeps the same alias from being inserted twice
-- for the same entity, but allows the same alias for different entities
-- (e.g. "CDC" → CDC the agency AND "CDC" → some other CDC-named vendor).
CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_alias_dedup
  ON entity_alias(alias_lower, entity_kind, canonical_id);
CREATE INDEX IF NOT EXISTS idx_entity_alias_lookup
  ON entity_alias(alias_lower, entity_kind);
CREATE INDEX IF NOT EXISTS idx_entity_alias_canonical
  ON entity_alias(entity_kind, canonical_id);
