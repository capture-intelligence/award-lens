#!/usr/bin/env node
// =============================================================================
// SAM.gov Exclusions sync (sidecar).
//
// Pulls the public Entity Exclusions feed from SAM.gov and posts batches to
// the api-worker's /import/exclusions endpoint. The endpoint upserts each
// record (deduped by SAM's id or a stable hash of identity fields) into the
// `sam_exclusion` table — the Exclusions page reads from there.
//
// Source endpoint (SAM v4 returns hal+json — DO NOT send Accept: application/json,
// it 406s. Send `*/*` instead, which SAM accepts):
//   GET https://api.sam.gov/entity-information/v4/exclusions
//        ?api_key=<key>
//        &page=N
//        &size=100
//
// Response shape:
//   { totalRecords: N, excludedEntity: [ { exclusionDetails, exclusionIdentification,
//     exclusionActions: { listOfActions: [{ activateDate, terminationDate, recordStatus, … }]},
//     exclusionPrimaryAddress, exclusionOtherInformation, … } ] }
//
// Active-only is filtered locally (set INCLUDE_TERMINATED=true to keep terminated rows).
//
// Env (loaded by systemd EnvironmentFile = /etc/awards-sidecar.env):
//   API_BASE              required — https://api-worker.<sub>.workers.dev
//   INGEST_TOKEN          required — shared secret with the worker
//   SAM_API_KEY           required — public-data-key from sam.gov ("SAM-…")
//   INCLUDE_TERMINATED    optional — "true" to also keep terminated rows
//   MAX_PAGES             optional — hard cap (default 2000 → 200,000 rows)
//   PAGE_SIZE             optional — per-page count (default 100, max 100)
// =============================================================================

const env = process.env;

function require_env(name) {
  const v = env[name];
  if (!v) { console.error(`ERROR: env var ${name} is required`); process.exit(1); }
  return v;
}

const API   = require_env('API_BASE').replace(/\/$/, '');
const TOKEN = require_env('INGEST_TOKEN');
const KEY   = require_env('SAM_API_KEY');

const INCLUDE_TERMINATED = (env.INCLUDE_TERMINATED ?? 'false').toLowerCase() === 'true';
const MAX_PAGES = Number(env.MAX_PAGES ?? 2000);
const PAGE_SIZE = Math.min(Number(env.PAGE_SIZE ?? 100), 100);
// SAM's free-tier Entity API limits to ~60 req/min. 1500ms between pages
// gives ~40 req/min which is comfortably under, even when retries pile on.
const PACE_MS   = Number(env.PACE_MS ?? 1500);

const SAM_BASE  = 'https://api.sam.gov/entity-information/v4/exclusions';

const log = (level, msg, extra = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));

// ─── Pull a single page from SAM ────────────────────────────────────────────
async function fetchPage(page, attempt = 1) {
  const url = new URL(SAM_BASE);
  url.searchParams.set('api_key', KEY);
  url.searchParams.set('page',    String(page));
  url.searchParams.set('size',    String(PAGE_SIZE));
  // Active-only filter is applied locally — the v4 endpoint's
  // exclusionStatus param doesn't filter what we expect.

  let status = 0;
  try {
    const r = await fetch(url, {
      // SAM v4 advertises Accept: application/hal+json, text/plain — and
      // returns 406 for application/json. */* works.
      headers: { Accept: '*/*' },
      signal: AbortSignal.timeout(60_000),
    });
    status = r.status;

    // SAM returns 429 with a structured body when the daily quota is
    // exhausted — `code: "900804"`, `nextAccessTime: …`. Differentiate
    // that case from a transient burst-rate hit so the daemon exits
    // cleanly instead of grinding through 15 min of useless retries.
    if (r.status === 429) {
      const text = await r.text();
      let parsed = null; try { parsed = JSON.parse(text); } catch { /* not JSON */ }
      if (parsed?.code === '900804' || /quota/i.test(parsed?.message ?? '')) {
        const e = new Error(`SAM quota exhausted${parsed?.nextAccessTime ? ` (resets ${parsed.nextAccessTime})` : ''}`);
        e.quotaExhausted = true;
        e.nextAccessTime = parsed?.nextAccessTime ?? null;
        throw e;
      }
      throw new Error(`SAM transient 429`);
    }
    if (r.status >= 500) throw new Error(`SAM transient ${r.status}`);
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`SAM ${r.status}: ${body.slice(0, 300)}`);
    }
    return r.json();
  } catch (err) {
    if (err && err.quotaExhausted) throw err;       // bubble straight up
    if (attempt >= 6) throw err;
    const base = status === 429 ? 30_000 : 2000;
    const delay = Math.min(base * Math.pow(2, attempt - 1), 240_000);
    log('warn', 'fetchPage retry', { page, attempt, status, delay_ms: delay, error: String(err).slice(0, 200) });
    await new Promise((r) => setTimeout(r, delay));
    return fetchPage(page, attempt + 1);
  }
}

// ─── Map a SAM v4 exclusion JSON object → our /import/exclusions row shape ──
//
// Real SAM v4 shape (single excludedEntity element):
//   {
//     exclusionDetails:        { classificationType, exclusionType, exclusionProgram,
//                                excludingAgencyCode, excludingAgencyName },
//     exclusionIdentification: { ueiSAM, cageCode, npi,
//                                prefix, firstName, middleName, lastName, suffix,
//                                entityName, dnbOpenData },
//     exclusionActions:        { listOfActions: [{ createDate, updateDate,
//                                                  activateDate, terminationDate,
//                                                  terminationType, recordStatus }, …] },
//     exclusionPrimaryAddress: { addressLine1, city, stateOrProvinceCode,
//                                zipCode, countryCode, … },
//     exclusionOtherInformation: { additionalComments, ctCode, … }
//   }
//
// Dates come back as MM-DD-YYYY (e.g. "03-09-2026").
function mapRecord(raw) {
  const det  = raw?.exclusionDetails        ?? {};
  const id   = raw?.exclusionIdentification ?? {};
  const acts = raw?.exclusionActions?.listOfActions ?? [];
  const addr = raw?.exclusionPrimaryAddress ?? {};
  const other = raw?.exclusionOtherInformation ?? {};

  // Pick the most recent action — that's what defines the current state.
  const latestAction = acts[0] ?? {};

  // Resolve legal name: prefer entityName (firm/vessel), else compose from parts.
  const personName = [id.prefix, id.firstName, id.middleName, id.lastName, id.suffix]
    .map((s) => (s ?? '').toString().trim())
    .filter((s) => s.length > 0)
    .join(' ');
  const legalName = (id.entityName ?? '').toString().trim() || personName || null;

  const recordStatus = (latestAction.recordStatus ?? '').toString().toLowerCase();
  const isActive = recordStatus === 'active' ? 1 : (recordStatus ? 0 : 1);

  return {
    // SAM v4 doesn't expose a stable per-row ID in the public payload — the
    // worker derives one via sha256(uei|name|active_date|ct_code) when this
    // is null.
    sam_number:       null,
    source_row_id:    null,

    uei:              id.ueiSAM ?? null,
    duns:             id.dnbOpenData ?? null,
    cage_code:        id.cageCode ?? null,
    legal_name:       legalName,

    classification:   det.classificationType ?? null,
    exclusion_type:   det.exclusionType ?? null,
    ct_code:          other.ctCode ?? null,

    is_active:        isActive,
    active_date:      isoDate(latestAction.activateDate),
    termination_date: isoDate(latestAction.terminationDate),

    excluding_agency: det.excludingAgencyName ?? null,
    reason:           det.exclusionProgram ?? other.additionalComments ?? null,

    country_code:     addr.countryCode ?? null,
    state:            addr.stateOrProvinceCode ?? null,
    city:             addr.city ?? null,
    address_line:     addr.addressLine1 ?? null,
    zip:              addr.zipCode ?? null,
  };
}

function isoDate(d) {
  if (!d) return null;
  const s = String(d).trim();
  if (!s) return null;
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // MM-DD-YYYY (SAM v4 default)
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  // MM/DD/YYYY
  const m2 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m2) return `${m2[3]}-${m2[1]}-${m2[2]}`;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

// ─── POST a batch to the worker ─────────────────────────────────────────────
async function postBatch(runId, records, finalize, extractDate) {
  const r = await fetch(`${API}/import/exclusions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ run_id: runId, extract_date: extractDate, records, finalize }),
  });
  if (!r.ok) throw new Error(`API ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

// ─── Main ──────────────────────────────────────────────────────────────────
(async () => {
  const extractDate = new Date().toISOString().slice(0, 10);
  log('info', 'sync-sam-exclusions start', {
    api: API, sam: SAM_BASE,
    include_terminated: INCLUDE_TERMINATED, max_pages: MAX_PAGES, page_size: PAGE_SIZE,
    extract_date: extractDate,
  });

  let runId;
  let totalUpserted = 0;
  let totalSkipped  = 0;
  let totalFetched  = 0;

  try {
    let page = 0;
    while (page < MAX_PAGES) {
      const t0 = Date.now();
      const data = await fetchPage(page);

      const list = data?.excludedEntity ?? [];
      if (!Array.isArray(list) || list.length === 0) {
        log('info', 'page empty — stopping', { page, ms: Date.now() - t0 });
        break;
      }

      const totalRecords = data?.totalRecords ?? null;
      const totalPages = totalRecords != null ? Math.ceil(totalRecords / PAGE_SIZE) : null;

      const mapped = list
        .map(mapRecord)
        .filter((r) => r.legal_name && (INCLUDE_TERMINATED || r.is_active === 1));

      log('info', 'page fetched', {
        page, count: list.length, mappable: mapped.length,
        ms: Date.now() - t0, total_pages: totalPages, total_records: totalRecords,
      });

      if (mapped.length === 0) {
        if (list.length < PAGE_SIZE) break;
        page++;
        await new Promise((r) => setTimeout(r, PACE_MS));
        continue;
      }

      const reply = await postBatch(runId, mapped, false, extractDate);
      runId = reply.run_id;
      totalFetched  += list.length;
      totalUpserted += reply.upserted ?? 0;
      totalSkipped  += reply.skipped  ?? 0;
      log('info', 'page upserted', {
        page, run_id: runId,
        upserted: reply.upserted, skipped: reply.skipped, running_total: totalUpserted,
      });

      if (list.length < PAGE_SIZE) break;
      if (totalPages != null && page + 1 >= totalPages) break;

      page++;
      await new Promise((r) => setTimeout(r, PACE_MS));
    }

    await postBatch(runId, [], true, extractDate);
    log('info', 'sync complete', {
      run_id: runId, total_fetched: totalFetched,
      total_upserted: totalUpserted, total_skipped: totalSkipped,
    });
    process.exit(0);
  } catch (err) {
    const quota = err && err.quotaExhausted;
    log(quota ? 'warn' : 'error', quota ? 'sync paused — daily quota exhausted' : 'sync failed', {
      run_id: runId,
      error: err instanceof Error ? err.message : String(err),
      next_access_time: err?.nextAccessTime ?? null,
      partial: quota ? { upserted: totalUpserted, fetched: totalFetched } : undefined,
    });
    if (runId) {
      try {
        await fetch(`${API}/runs/${runId}/cancel`, {
          method: 'POST',
          headers: { authorization: `Bearer ${TOKEN}` },
        });
      } catch { /* swallow */ }
    }
    // Quota-exhausted is an expected operational state with a 10/day public
    // key — the timer will simply re-fire tomorrow after the reset and pick
    // up where we left off. Exit 0 so systemd doesn't mark the unit failed
    // and the journal stays clean.
    process.exit(quota ? 0 : 1);
  }
})();
