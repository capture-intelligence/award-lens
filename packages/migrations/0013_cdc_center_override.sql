-- ─────────────────────────────────────────────────────────────────────────
-- PIID-keyed center overrides
-- ─────────────────────────────────────────────────────────────────────────
--
-- Federal-account → center mapping (cdc_center) is mostly authoritative,
-- but two situations need a per-award override:
--
--   1. Co-funding tie-breaks — when an award draws from two priority-1
--      accounts (e.g., 075-0950 NCHHSTP + 075-0959 PHSS) the lowest-
--      priority pick is undefined and the wrong center can win.
--
--   2. Sub-center disambiguation — federal account 075-0959 houses both
--      NCHS and CSELS; the only way to tell them apart is from contract
--      content (NHANES → NCHS, BRFSS → NCHS, lab/safety → CSELS, etc).
--
-- An override row beats the federal-account lookup. Both the /explore
-- decorate() and the /explore?center_code= SQL filter consult this table
-- before falling back to the priority-window resolution. /centers also
-- folds overrides into its enumeration so they show up in the picker.
--
-- Adding rows: insert (award_piid, center_code, center_name, reason).
-- The `reason` field is captured for future audit / ops debugging.

CREATE TABLE IF NOT EXISTS cdc_center_override (
  award_piid   TEXT PRIMARY KEY,
  center_code  TEXT NOT NULL,
  center_name  TEXT NOT NULL,
  reason       TEXT,
  created_at   INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
);

-- Seed: known misclassifications.
INSERT OR REPLACE INTO cdc_center_override
  (award_piid, center_code, center_name, reason)
VALUES
  ('75D30121F10253', 'NCHS',
   'National Center for Health Statistics',
   'NHANES IT support delivery order — funded through 075-0959 (PHSS / NCHS) but a co-funded line from 075-0950 (NCHHSTP, also priority 1) caused the priority tie-break to pick NCHHSTP. NHANES is run by NCHS.');
