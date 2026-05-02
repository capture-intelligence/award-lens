#!/usr/bin/env node
// =============================================================================
// AwardLens — local SOW PDF text extraction.
//
// Why local? PDF parsing is CPU-bound and has zero per-call cost (no SAM API
// quota involvement — these are public S3 downloads). Running on the laptop
// avoids burning VM cycles on a job that's bursty by nature (a few hundred
// PDFs to extract once, then trickle as new solicitations post).
//
// USAGE (PowerShell on Windows):
//   $env:INGEST_TOKEN="..."
//   $env:API_BASE="https://api-worker.algocrat.workers.dev"
//   node tools/extract-sow-text-local.mjs
//
// USAGE (bash):
//   INGEST_TOKEN=... API_BASE=https://api-worker.algocrat.workers.dev \
//     node tools/extract-sow-text-local.mjs
//
// What it does:
//   1. GET /sidecar/solicitations/needing-extraction → batch of attachments
//      with file_url but no extracted_text or extract_error.
//   2. For each: fetch file_url (Node fetch follows the SAM 303 to S3 cleanly,
//      unlike curl on MSYS which mangles the signed URL). Validate %PDF magic.
//      Compute sha256. Run pdf-parse.
//   3. POST results in batches to /sidecar/solicitations/extract-text. Each
//      row carries either extracted_text + char count, or extract_error.
//   4. Loop until two empty batches in a row, then exit.
//
// Optional env:
//   BATCH_SIZE   — attachments per worker fetch (default 25)
//   MAX_BYTES    — refuse PDFs above this size (default 25 MB)
//   PACE_MS      — sleep between PDF downloads (default 250ms; we're hitting
//                  AWS S3 not SAM, so no quota concern, but be polite)
//   MAX_BATCHES  — stop after N batches (default Infinity)
//   DRY_RUN      — set "1" to fetch + log without posting back
// =============================================================================

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

// pdf-parse ships a CJS entrypoint that, when imported via the package main,
// runs an index.js debug block that tries to read a hardcoded test PDF and
// fails with ENOENT. Import the lib file directly to skip that block.
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const env = process.env;
function need(name) {
  const v = env[name];
  if (!v) { console.error(`ERROR: env var ${name} is required`); process.exit(1); }
  return v;
}

const API   = need('API_BASE').replace(/\/$/, '');
const TOKEN = need('INGEST_TOKEN');

const BATCH_SIZE  = Number(env.BATCH_SIZE  ?? 25);
const MAX_BYTES   = Number(env.MAX_BYTES   ?? 25 * 1024 * 1024);
const PACE_MS     = Number(env.PACE_MS     ?? 250);
const MAX_BATCHES = Number(env.MAX_BATCHES ?? Infinity);
const DRY_RUN     = (env.DRY_RUN ?? '') === '1';

const log = (level, msg, extra = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Worker calls ───────────────────────────────────────────────────────────

async function fetchBatchFromWorker() {
  const url = `${API}/sidecar/solicitations/needing-extraction?limit=${BATCH_SIZE}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`worker GET ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return data.results ?? [];
}

async function postBack(updates) {
  if (DRY_RUN) {
    log('info', 'dry-run: would post', { count: updates.length });
    return { accepted: updates.length, applied: 0 };
  }
  const r = await fetch(`${API}/sidecar/solicitations/extract-text`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ updates }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`worker POST ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// ─── PDF download + extraction ──────────────────────────────────────────────

// Pull a guess of the original filename out of the S3 redirect URL's
// response-content-disposition param. SAM signs S3 URLs with this param so
// the browser would download with the human-readable filename rather than
// the UUID. We harvest it for storage so the UI can show a real name.
function filenameFromFinalUrl(finalUrl) {
  try {
    const u = new URL(finalUrl);
    const cd = u.searchParams.get('response-content-disposition');
    if (!cd) return null;
    const m = cd.match(/filename\s*=\s*"?([^";]+)"?/i);
    return m?.[1] ? decodeURIComponent(m[1].replace(/\+/g, ' ')).trim() : null;
  } catch {
    return null;
  }
}

async function downloadPdf(fileUrl) {
  const r = await fetch(fileUrl, { redirect: 'follow', signal: AbortSignal.timeout(45_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} on download`);
  const len = Number(r.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES) throw new Error(`too large: ${len} bytes`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`too large after download: ${buf.length} bytes`);
  // Validate PDF magic. Some "PDFs" turn out to be Office docs or zips —
  // we record an extract_error so they don't get retried.
  const magic = buf.slice(0, 4).toString('ascii');
  if (magic !== '%PDF') throw new Error(`not a PDF (magic=${JSON.stringify(magic)})`);
  return {
    bytes:        buf,
    finalUrl:     r.url,
    contentType:  r.headers.get('content-type') ?? null,
    sizeBytes:    buf.length,
    fileName:     filenameFromFinalUrl(r.url),
  };
}

async function extractText(buf) {
  const out = await pdfParse(buf, {
    // pdf-parse renders every page by default. For 200-page solicitation
    // packets that's fine — we want the whole thing. No page cap.
  });
  return {
    text:  (out.text ?? '').trim(),
    pages: out.numpages ?? null,
  };
}

async function processOne(row) {
  if (!row?.file_url) {
    return { attachment_id: row?.attachment_id, extract_error: 'no file_url' };
  }
  let dl;
  try {
    dl = await downloadPdf(row.file_url);
  } catch (e) {
    return { attachment_id: row.attachment_id, extract_error: `download: ${String(e).slice(0, 250)}` };
  }
  let text;
  try {
    text = await extractText(dl.bytes);
  } catch (e) {
    return {
      attachment_id: row.attachment_id,
      file_name:     dl.fileName,
      content_type:  dl.contentType,
      size_bytes:    dl.sizeBytes,
      sha256:        createHash('sha256').update(dl.bytes).digest('hex'),
      extract_error: `parse: ${String(e).slice(0, 250)}`,
    };
  }
  return {
    attachment_id:   row.attachment_id,
    extracted_text:  text.text,
    extracted_chars: text.text.length,
    file_name:       dl.fileName,
    content_type:    dl.contentType,
    size_bytes:      dl.sizeBytes,
    sha256:          createHash('sha256').update(dl.bytes).digest('hex'),
  };
}

// ─── Main loop ──────────────────────────────────────────────────────────────

async function runBatch() {
  const rows = await fetchBatchFromWorker();
  if (rows.length === 0) {
    log('info', 'no attachments need extraction');
    return { processed: 0, applied: 0 };
  }
  log('info', 'batch start', { count: rows.length });

  const updates = [];
  let extracted = 0, errored = 0;
  for (const row of rows) {
    const u = await processOne(row);
    updates.push(u);
    if (u.extract_error) {
      errored += 1;
      log('warn', 'row failed', {
        attachment_id: u.attachment_id, error: u.extract_error.slice(0, 200),
      });
    } else {
      extracted += 1;
      log('info', 'row ok', {
        attachment_id: u.attachment_id,
        chars: u.extracted_chars,
        file_name: u.file_name,
      });
    }
    await sleep(PACE_MS);
  }
  let applied = 0;
  if (updates.length > 0) {
    const result = await postBack(updates);
    applied = result?.applied ?? 0;
    log('info', 'batch done', {
      processed: updates.length, extracted, errored,
      accepted: result?.accepted ?? 0, applied,
    });
  }
  return { processed: updates.length, applied };
}

(async () => {
  log('info', 'extract-sow-text-local start', {
    api: API, batch_size: BATCH_SIZE, pace_ms: PACE_MS,
    max_bytes: MAX_BYTES, dry_run: DRY_RUN, max_batches: MAX_BATCHES,
  });

  let totalApplied = 0, consecutiveZero = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const { processed, applied } = await runBatch();
    totalApplied += applied;
    if (processed === 0) {
      consecutiveZero += 1;
      if (consecutiveZero >= 2) { log('info', 'two empty batches in a row — done'); break; }
      await sleep(3000);
    } else {
      consecutiveZero = 0;
    }
  }
  log('info', 'extract-sow-text-local complete', { total_applied: totalApplied });
})().catch((err) => {
  log('error', 'fatal', {
    error: String(err).slice(0, 300),
    stack: String(err?.stack ?? '').slice(0, 800),
  });
  process.exit(1);
});
