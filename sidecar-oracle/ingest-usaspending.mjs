#!/usr/bin/env node
// =============================================================================
// Oracle Cloud sidecar — USAspending → api-worker/import/awards
//
// Runs on an Oracle Always Free VM under a systemd timer. Fetches USAspending
// from the VM's IP (not Cloudflare's blocked ranges), then posts normalized
// pages to the Cloudflare api-worker for upsert into D1.
//
// Config via environment variables (loaded by systemd EnvironmentFile):
//
//   API_BASE              (required) — https://api-worker.<sub>.workers.dev
//   INGEST_TOKEN          (required) — shared secret matching the Worker's
//                                      INGEST_TOKEN secret
//   SINCE                 YYYY-MM-DD  (default: 90 days ago)
//   UNTIL                 YYYY-MM-DD  (default: today)
//   MAX_PAGES             integer     (default: 10)
//   AGENCIES              "A,B" — toptier agency names
//   SUBTIER_AGENCIES      "A,B"
//   KEYWORDS              "K1,K2"
//   NAICS_CODES           "123,456"
//   PSC_CODES             "R408,Q301"
//   RECIPIENT             "Lantana"
//   MIN_VALUE             integer (USD)
//   MAX_VALUE             integer (USD)
//   AWARD_TYPES           "A,B,C,D" (default: contracts)
//
// Exit codes: 0 = success, 1 = failure (systemd will log/alert)
// =============================================================================

const USA_BASE = 'https://api.usaspending.gov/api/v2';
const PAGE_SIZE = 100;
const PACE_MS = 1500;
const DRY = process.argv.includes('--dry-run');

// ─── Env & validation ──────────────────────────────────────────────────────
const env = process.env;

function requireEnv(name) {
  const v = env[name];
  if (!v) { console.error(`ERROR: env var ${name} is required`); process.exit(1); }
  return v;
}
function csv(name) { return (env[name] ?? '').split(',').map((x) => x.trim()).filter(Boolean); }
function num(name) { const v = env[name]; if (!v) return undefined; const n = Number(v); return Number.isFinite(n) ? n : undefined; }

const API = requireEnv('API_BASE').replace(/\/$/, '');
const TOKEN = requireEnv('INGEST_TOKEN');

function isoDaysAgo(n) {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
const since = env.SINCE || isoDaysAgo(90);
const until = env.UNTIL || new Date().toISOString().slice(0, 10);
const maxPages = Number(env.MAX_PAGES || 10);

const filters = {};
if (csv('AGENCIES').length)          filters.agencies = csv('AGENCIES');
if (csv('SUBTIER_AGENCIES').length)  filters.subtier_agencies = csv('SUBTIER_AGENCIES');
if (csv('KEYWORDS').length)          filters.keywords = csv('KEYWORDS');
if (csv('NAICS_CODES').length)       filters.naics_codes = csv('NAICS_CODES');
if (csv('PSC_CODES').length)         filters.psc_codes = csv('PSC_CODES');
if (env.RECIPIENT)                   filters.recipient_search_text = env.RECIPIENT;
if (num('MIN_VALUE') !== undefined)  filters.award_amount_min = num('MIN_VALUE');
if (num('MAX_VALUE') !== undefined)  filters.award_amount_max = num('MAX_VALUE');
const awardTypes = csv('AWARD_TYPES').length ? csv('AWARD_TYPES') : ['A', 'B', 'C', 'D'];

// ─── Structured logging (one JSON object per line for journald) ────────────
function log(level, msg, extra = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));
}

log('info', 'sidecar start', { api: API, since, until, maxPages, filters, awardTypes, dry: DRY });

// ─── Build USAspending payload ─────────────────────────────────────────────
function buildPayload(page) {
  const fb = {
    time_period: [{ start_date: since, end_date: until, date_type: 'action_date' }],
    award_type_codes: awardTypes,
  };
  const agencyObjs = [];
  for (const name of filters.agencies ?? [])         agencyObjs.push({ type: 'awarding', tier: 'toptier', name });
  for (const name of filters.subtier_agencies ?? []) agencyObjs.push({ type: 'awarding', tier: 'subtier', name });
  if (agencyObjs.length) fb.agencies = agencyObjs;
  if (filters.keywords?.length)      fb.keywords = filters.keywords;
  if (filters.naics_codes?.length)   fb.naics_codes = filters.naics_codes;
  if (filters.psc_codes?.length)     fb.psc_codes = filters.psc_codes;
  if (filters.recipient_search_text) fb.recipient_search_text = [filters.recipient_search_text];
  if (filters.award_amount_min != null || filters.award_amount_max != null) {
    const b = {};
    if (filters.award_amount_min != null) b.lower_bound = filters.award_amount_min;
    if (filters.award_amount_max != null) b.upper_bound = filters.award_amount_max;
    fb.award_amounts = [b];
  }
  return {
    filters: fb,
    fields: [
      'Award ID', 'Recipient Name', 'Recipient UEI',
      'Award Amount', 'Total Outlays', 'Description',
      'Contract Award Type', 'Start Date', 'End Date',
      'Awarding Agency', 'Awarding Sub Agency', 'Funding Agency',
      'NAICS', 'PSC', 'Last Modified Date',
      'recipient_id',
      'Place of Performance State Code',
      'Place of Performance Country Code',
    ],
    sort: 'Last Modified Date',
    order: 'asc',
    limit: PAGE_SIZE,
    page,
  };
}

// ─── Fetch w/ retry ───────────────────────────────────────────────────────
async function fetchPage(page, attempt = 1) {
  try {
    const res = await fetch(`${USA_BASE}/search/spending_by_award/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(buildPayload(page)),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`USAspending ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  } catch (err) {
    if (attempt >= 4) throw err;
    const delay = Math.min(2000 * Math.pow(2, attempt - 1), 20_000);
    log('warn', `fetchPage retry`, { page, attempt, delay_ms: delay, error: String(err).slice(0, 200) });
    await new Promise((r) => setTimeout(r, delay));
    return fetchPage(page, attempt + 1);
  }
}

// ─── POST to api-worker ───────────────────────────────────────────────────
async function postPage(runId, pageData, finalize = false) {
  const body = {
    run_id: runId,
    response: pageData,
    finalize,
    metadata: { source: 'oracle-sidecar', filters, since, until, host: process.env.HOSTNAME ?? 'oracle-vm' },
  };
  if (DRY) { log('info', 'dry-run skipping POST', { finalize, size: pageData?.results?.length ?? 0 }); return { run_id: runId ?? -1, upserted: 0, failed: 0 }; }
  const res = await fetch(`${API}/import/awards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// ─── Main ──────────────────────────────────────────────────────────────────
(async () => {
  let runId;
  let page = 1;
  let total = 0;
  let totalFailed = 0;

  try {
    while (page <= maxPages) {
      const t0 = Date.now();
      const data = await fetchPage(page);
      const count = data.results?.length ?? 0;
      const hasNext = data.page_metadata?.hasNext ?? false;
      log('info', 'page fetched', { page, count, ms: Date.now() - t0 });

      const up = await postPage(runId, data);
      runId = up.run_id;
      total += up.upserted ?? 0;
      totalFailed += up.failed ?? 0;
      log('info', 'page upserted', { page, run_id: runId, upserted: up.upserted, failed: up.failed, running_total: total });

      if (!hasNext || count < PAGE_SIZE) break;
      page++;
      await new Promise((r) => setTimeout(r, PACE_MS));
    }

    await postPage(runId, { results: [] }, true);
    log('info', 'run complete', { run_id: runId, total_upserted: total, total_failed: totalFailed });
    process.exit(0);
  } catch (err) {
    log('error', 'run failed', { page, run_id: runId, error: err instanceof Error ? err.message : String(err) });
    if (runId && !DRY) {
      try { await fetch(`${API}/runs/${runId}/cancel`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } }); } catch { /* swallow */ }
    }
    process.exit(1);
  }
})();
