-- ─────────────────────────────────────────────────────────────────────────
-- Covering index for the description-enrichment workqueue
-- ─────────────────────────────────────────────────────────────────────────
--
-- GET /sidecar/awards/needing-description-enrich joins
--   award a  JOIN  external_id_mapping m
--     ON m.internal_id = a.award_id
--    AND m.source_id   = 'usaspending'
--    AND m.entity_type = 'award'
--
-- The only existing index is idx_extmap_internal(internal_id, entity_type),
-- which does not cover source_id, so SQLite walks every mapping row for
-- every award. Measured via `wrangler d1 insights` (2026-10-24):
--   10,658 rows read per call, ~12 calls/day, 4.16M rows over 31 days —
--   58% of all reads on the database — to return ≤6 rows.
--
-- This index lets the planner seek directly on (source_id, entity_type)
-- then range over internal_id, reducing the join to ~1 read per award.

CREATE INDEX IF NOT EXISTS idx_extmap_source_type_internal
  ON external_id_mapping(source_id, entity_type, internal_id);
