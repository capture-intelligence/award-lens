-- ─────────────────────────────────────────────────────────────────────────
-- Phase 1 description enrichment columns
-- ─────────────────────────────────────────────────────────────────────────
--
-- The dashboard currently shows the truncated `description` from
-- USAspending's /search/spending_by_award/ endpoint. This migration adds
-- two richer fields the sidecar can populate from per-award detail calls:
--
--   description_long         — longer "what the contract is" text from
--                              /awards/{award_id}/ (often 3-6 sentences
--                              vs the search row's 1-2)
--   mod_history              — chronological narrative built from
--                              /awards/transactions/, one line per
--                              modification ("[date] MOD nn — text"),
--                              joined with `\n---\n`
--   description_enriched_at  — epoch ms; sidecar refreshes rows where
--                              this is NULL or older than its threshold

ALTER TABLE award ADD COLUMN description_long TEXT;
ALTER TABLE award ADD COLUMN mod_history TEXT;
ALTER TABLE award ADD COLUMN description_enriched_at INTEGER;

-- Sidecar's "find oldest 100 to refresh" query orders by this column.
CREATE INDEX IF NOT EXISTS idx_award_description_enriched_at
  ON award(description_enriched_at);
