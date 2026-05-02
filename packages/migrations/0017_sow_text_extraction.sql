-- ─────────────────────────────────────────────────────────────────────────
-- Phase 3a/3b: SOW PDF text extraction + summarization
-- ─────────────────────────────────────────────────────────────────────────
--
-- We're storing extracted text directly in D1 instead of the originally
-- planned R2 + extract-from-R2 pipeline. Reasons:
--   1. The current Cloudflare API token lacks R2:Edit scope (same blocker
--      as Vectorize:Edit). Skipping R2 unblocks the work entirely.
--   2. For our AI use cases (semantic search, summarization, RAG) we only
--      ever need the text — never the original PDF bytes. Storing PDFs in
--      R2 just to immediately re-fetch and extract them is wasted I/O.
--   3. D1 holds TEXT columns of arbitrary size up to the per-row limit
--      (~1MB in practice). Median SOW PDF extracts to ~30-100KB of text.
--      Outliers get truncated with a note rather than rejected.
--
-- Pipeline:
--   1. Local script (tools/extract-sow-text-local.mjs) GETs
--      /sidecar/solicitations/needing-extraction
--   2. For each row: fetch file_url (Node fetch follows the SAM 303 to S3),
--      validate %PDF magic, run pdf-parse, capture text + char count
--   3. POST results to /sidecar/solicitations/extract-text
--   4. Worker upserts extracted_text + extracted_at + extracted_chars OR
--      extract_error if extraction failed
--
-- Phase 3b summarization uses the same pattern with sow_summary and
-- summarized_at, called by a sidecar that hits Workers AI's Llama 3.1 8B.

ALTER TABLE solicitation_attachment ADD COLUMN extracted_text TEXT;
ALTER TABLE solicitation_attachment ADD COLUMN extracted_chars INTEGER;
ALTER TABLE solicitation_attachment ADD COLUMN extracted_at INTEGER;
ALTER TABLE solicitation_attachment ADD COLUMN extract_error TEXT;
ALTER TABLE solicitation_attachment ADD COLUMN sow_summary TEXT;
ALTER TABLE solicitation_attachment ADD COLUMN summarized_at INTEGER;

-- Workqueue indexes — partial indexes keep them tiny since most rows are
-- already in their terminal state (extracted+summarized, or errored).
CREATE INDEX IF NOT EXISTS idx_solicitation_attachment_needing_extraction
  ON solicitation_attachment(solicitation_id)
  WHERE extracted_text IS NULL AND extract_error IS NULL AND file_type = 'PDF';

CREATE INDEX IF NOT EXISTS idx_solicitation_attachment_needing_summary
  ON solicitation_attachment(solicitation_id)
  WHERE sow_summary IS NULL AND extracted_text IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────
-- Backfill: populate solicitation_attachment from existing raw_json.
-- ─────────────────────────────────────────────────────────────────────────
--
-- The original sync-sam-opportunities.mjs assumed resourceLinks was an
-- array of objects ({fileName, url, mimeType, ...}). Live SAM data is
-- a plain array of URL strings ("https://sam.gov/api/.../files/<UUID>/download").
-- The mapAttachments filter rejected every entry, so zero attachments
-- ever made it into D1 even though 22 solicitations are stored.
--
-- This backfill reads the raw_json that's already in D1 and writes
-- attachment rows. The download URL embeds the resource UUID between
-- "/files/" and "/download", which we extract as the primary key.
-- file_type defaults to PDF (the local extractor will record an error
-- and surface non-PDFs via extract_error).
INSERT OR IGNORE INTO solicitation_attachment
  (attachment_id, solicitation_id, file_name, file_url, file_type)
SELECT
  -- UUID between "/files/" and "/download" in the SAM download URL
  substr(
    je.value,
    instr(je.value, '/files/') + 7,
    instr(je.value, '/download') - instr(je.value, '/files/') - 7
  ) AS attachment_id,
  s.solicitation_id,
  NULL                    AS file_name,
  je.value                AS file_url,
  'PDF'                   AS file_type
FROM solicitation s, json_each(json_extract(s.raw_json, '$.resourceLinks')) je
WHERE json_extract(s.raw_json, '$.resourceLinks') IS NOT NULL
  AND json_type(json_extract(s.raw_json, '$.resourceLinks')) = 'array'
  AND je.value LIKE 'https://sam.gov/api/%/files/%/download%';
