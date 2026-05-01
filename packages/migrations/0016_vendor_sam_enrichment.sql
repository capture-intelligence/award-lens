-- ─────────────────────────────────────────────────────────────────────────
-- Vendor enrichment from SAM.gov Entity Registration API
-- ─────────────────────────────────────────────────────────────────────────
--
-- The `vendor` table currently has just the basics (uei, legal_name,
-- address). SAM.gov's Entity Registration API exposes much more:
-- CAGE code, business types (set-aside eligibility), registration status,
-- self-certified NAICS codes, expiration dates.
--
-- These power: vendor profile pages, set-aside filters in Pipeline view,
-- and "registration expiring" warnings.
--
-- Sidecar (sync-sam-vendors.mjs) walks vendors lacking sam_enriched_at,
-- queries SAM by UEI, posts results back to the worker.

ALTER TABLE vendor ADD COLUMN cage_code            TEXT;
ALTER TABLE vendor ADD COLUMN business_types       TEXT;       -- pipe-delimited list
ALTER TABLE vendor ADD COLUMN sam_status           TEXT;       -- "Active" | "Inactive" | "Expired"
ALTER TABLE vendor ADD COLUMN sam_expires_at       TEXT;       -- ISO YYYY-MM-DD
ALTER TABLE vendor ADD COLUMN vendor_naics_codes   TEXT;       -- pipe-delimited self-certified
ALTER TABLE vendor ADD COLUMN sam_enriched_at      INTEGER;    -- epoch ms

CREATE INDEX IF NOT EXISTS idx_vendor_sam_enriched_at
  ON vendor(sam_enriched_at);
