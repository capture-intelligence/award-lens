-- ─────────────────────────────────────────────────────────────────────────
-- Pre-award intelligence: SAM.gov contract opportunities (solicitations)
-- ─────────────────────────────────────────────────────────────────────────
--
-- Federal agencies post their procurement intent as "solicitations" on
-- SAM.gov before any contract gets awarded. Notice types include:
--
--   - RFP (Request for Proposals)
--   - RFI (Request for Information)
--   - RFQ (Request for Quotations)
--   - Sources Sought
--   - Combined Synopsis/Solicitation
--   - Special Notice
--   - Justification & Approval (sole-source)
--
-- Each solicitation has metadata (title, agency, dates, NAICS/PSC codes,
-- set-aside type, place of performance) plus zero or more attachments
-- (the SOW/PWS PDF being the most valuable). We mirror both into D1, with
-- the raw JSON kept in `raw_json` for backfill if our schema misses
-- a field SAM later starts populating.
--
-- The dashboard's new "Pipeline" tab queries this table to show what's
-- coming. Once Phase 3a (SOW PDF extraction) lands, attachments get
-- stored in R2 and `solicitation_attachment.r2_key` populated.

CREATE TABLE IF NOT EXISTS solicitation (
  -- noticeId from SAM.gov — guaranteed unique per posting
  solicitation_id    TEXT PRIMARY KEY,
  -- Solicitation number (sometimes called "sol number") — agency-controlled,
  -- often used to link to subsequent contract via PIID prefix
  sol_number         TEXT,
  -- Notice type ("Solicitation", "Sources Sought", etc.)
  notice_type        TEXT NOT NULL,
  -- The agency-set title; varies in quality
  title              TEXT NOT NULL,

  -- Dates (all ISO YYYY-MM-DD)
  posted_date        TEXT,
  response_deadline  TEXT,
  archive_date       TEXT,

  -- Awarding agency hierarchy (free-text from SAM, may not match
  -- USAspending's canonical_name exactly — best-effort join later)
  agency             TEXT,
  sub_agency         TEXT,
  office             TEXT,

  -- Classification
  naics_codes        TEXT,   -- pipe-delimited if multiple
  psc_codes          TEXT,   -- pipe-delimited
  set_aside          TEXT,   -- "Total Small Business", "8(a)", "WOSB", etc.
  set_aside_code     TEXT,

  -- Place of performance
  pop_country        TEXT,
  pop_state          TEXT,
  pop_city           TEXT,
  pop_zip            TEXT,

  -- Description as posted (may be HTML or plain text)
  description        TEXT,

  -- The SAM.gov UI URL (handy for tooltip "view on SAM" links)
  link               TEXT,

  -- Raw payload for backfill / debugging
  raw_json           TEXT,

  -- When we last refreshed this row
  enriched_at        INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
);

CREATE INDEX IF NOT EXISTS idx_solicitation_posted_date
  ON solicitation(posted_date);
CREATE INDEX IF NOT EXISTS idx_solicitation_response_deadline
  ON solicitation(response_deadline);
CREATE INDEX IF NOT EXISTS idx_solicitation_agency
  ON solicitation(agency);
CREATE INDEX IF NOT EXISTS idx_solicitation_notice_type
  ON solicitation(notice_type);


CREATE TABLE IF NOT EXISTS solicitation_attachment (
  -- Composite key (resourceId from SAM, scoped per solicitation)
  attachment_id      TEXT PRIMARY KEY,
  solicitation_id    TEXT NOT NULL,
  file_name          TEXT,
  file_url           TEXT,
  file_type          TEXT,        -- "PDF", "DOCX", "ZIP", "OTHER"
  content_type       TEXT,        -- HTTP content-type when fetched
  size_bytes         INTEGER,
  -- Sha256 of fetched bytes (Phase 3a). Lets us dedupe across solicitations
  -- that re-attach the same boilerplate doc.
  sha256             TEXT,
  -- R2 key once we've downloaded the attachment. Null until Phase 3a runs.
  r2_key             TEXT,
  fetched_at         INTEGER,
  FOREIGN KEY (solicitation_id) REFERENCES solicitation(solicitation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_solicitation_attachment_solicitation
  ON solicitation_attachment(solicitation_id);
