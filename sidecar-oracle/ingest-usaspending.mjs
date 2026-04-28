#!/usr/bin/env node
// =============================================================================
// Oracle Cloud sidecar — USAspending → api-worker/import/awards (PER VIEW)
//
// Runs on an Oracle Always Free VM under a systemd timer. For each enabled
// view defined in the dashboard (Admin → Views), fetches USAspending using
// THAT view's filters, then posts pages to the api-worker for upsert. Every
// award is also tagged into view_award against the view's id, which is what
// makes "scoped buckets per view" work end-to-end.
//
// Environment variables (loaded by systemd EnvironmentFile):
//
//   API_BASE              (required) — https://api-worker.<sub>.workers.dev
//   INGEST_TOKEN          (required) — shared secret matching the worker
//   MAX_PAGES_PER_VIEW    integer    (default 25)
//   FALLBACK_LOOKBACK_MO  integer    (default 24, used when a view omits it)
//   ONLY_VIEW             string     (optional view_id — if set, ingest just that one)
//
// Exit codes: 0 = success on every view, 1 = at least one view failed.
// =============================================================================

const USA_BASE = 'https://api.usaspending.gov/api/v2';
const PAGE_SIZE = 100;
const PACE_MS = 1500;
const DRY = process.argv.includes('--dry-run');

const env = process.env;
function require_env(name) {
  const v = env[name];
  if (!v) { console.error(`ERROR: env var ${name} is required`); process.exit(1); }
  return v;
}
const API = require_env('API_BASE').replace(/\/$/, '');
const TOKEN = require_env('INGEST_TOKEN');
// Permissive default: 100 pages × 100 records = up to 10K records per view
// per run. Override via MAX_PAGES_PER_VIEW env var if the view legitimately
// pulls more, but USAspending's API hard-caps page * size at 10000 anyway.
const MAX_PAGES = Number(env.MAX_PAGES_PER_VIEW || 100);
const FALLBACK_LOOKBACK_MO = Number(env.FALLBACK_LOOKBACK_MO || 24);
const ONLY_VIEW = env.ONLY_VIEW || null;

function log(level, msg, extra = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));
}

function isoMonthsOffset(monthsOffset) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + monthsOffset);
  return d.toISOString().slice(0, 10);
}

// ─── Translate a view's filter spec → USAspending filter block ────────────
function buildUsaspendingFilters(viewFilters) {
  const fb = {};
  // We want contracts whose CONTRACT END DATE falls in [today − lookback,
  // today + forward]. USAspending's /search/spending_by_award/ endpoint only
  // accepts {action_date, last_modified_date, date_signed, new_awards_only}
  // for time_period.date_type — it does NOT support filtering by contract
  // end date directly. So we cast a wide net on `action_date` (covers any
  // contract that had a modification within the broader window — option
  // exercises, closeouts, etc.) and let the worker prune the view_award
  // rows whose pop_end_date is outside the actual end-date window during
  // its finalize step.
  const lookbackMonths = Number(viewFilters.lookback_months || FALLBACK_LOOKBACK_MO);
  const forwardMonths  = Number(viewFilters.forward_months  ?? 0);

  // The CONTRACT-END window the operator cares about is
  // [today - lookback, today + forward] (e.g. -18mo / +6mo, sliding).
  // USAspending's /search/spending_by_award/ only filters on action_date,
  // so we have to overshoot at the API layer and let the worker post-purge
  // by pop_end_date.
  //
  // Why pad lookback at all: a contract that *ends* in (today - 18mo) was
  // signed earlier and may have had its last action_date well before that.
  // Padding `lookback + 12` months upstream catches them.
  // Why pad forward: contracts ending in (today + 6mo) are still being
  // modified now, so the until=today is fine.
  const actionDateSince = isoMonthsOffset(-(lookbackMonths + 12));
  const actionDateUntil = isoMonthsOffset(0);  // today — action_date is never future
  fb.time_period = [{
    start_date: actionDateSince,
    end_date:   actionDateUntil,
    date_type:  'action_date',
  }];

  // The actual contract-end-date window the worker should enforce post-ingest.
  // (Returned alongside filterBlock so it doesn't leak into the USAspending
  // payload — that endpoint rejects unknown fields.)
  const contractEndSince = isoMonthsOffset(-lookbackMonths);
  const contractEndUntil = forwardMonths > 0
    ? isoMonthsOffset(forwardMonths)
    : isoMonthsOffset(60);  // 5y ahead = effectively unbounded for procurement

  // Award types — default to procurement contracts if the view doesn't pick.
  fb.award_type_codes = (viewFilters.award_types && viewFilters.award_types.length)
    ? viewFilters.award_types
    : ['A', 'B', 'C', 'D'];

  // Agencies — USAspending /search/spending_by_award/ accepts a list of
  // {type, tier, name} objects in `agencies`. Names (canonical) work; codes
  // do not work for this endpoint.
  const agencyObjs = [];
  if (viewFilters.toptier_agency_name) {
    agencyObjs.push({ type: 'awarding', tier: 'toptier', name: viewFilters.toptier_agency_name });
  }
  if (viewFilters.subtier_agency_name) {
    agencyObjs.push({ type: 'awarding', tier: 'subtier', name: viewFilters.subtier_agency_name });
  }
  if (Array.isArray(viewFilters.office_names) && viewFilters.office_names.length) {
    for (const name of viewFilters.office_names) {
      if (name) agencyObjs.push({ type: 'awarding', tier: 'office', name });
    }
  }
  if (agencyObjs.length) fb.agencies = agencyObjs;

  if (viewFilters.keywords?.length)    fb.keywords    = viewFilters.keywords;
  if (viewFilters.naics_codes?.length) fb.naics_codes = viewFilters.naics_codes;
  if (viewFilters.psc_codes?.length)   fb.psc_codes   = viewFilters.psc_codes;

  // Place of performance — USAspending wants
  // place_of_performance_locations: [{country: "USA", state: "TX"}, ...]
  if (viewFilters.pop_states?.length) {
    fb.place_of_performance_locations = viewFilters.pop_states.map((state) => ({
      country: 'USA',
      state,
    }));
  }

  if (viewFilters.min_value != null || viewFilters.max_value != null) {
    const b = {};
    if (viewFilters.min_value != null) b.lower_bound = Number(viewFilters.min_value);
    if (viewFilters.max_value != null) b.upper_bound = Number(viewFilters.max_value);
    fb.award_amounts = [b];
  }

  return {
    filterBlock: fb,
    contract_end_since: contractEndSince,
    contract_end_until: contractEndUntil,
    action_date_since: actionDateSince,
    action_date_until: actionDateUntil,
  };
}

function payloadForPage(filterBlock, page) {
  return {
    filters: filterBlock,
    fields: [
      'Award ID', 'Recipient Name', 'Recipient UEI',
      'Award Amount', 'Total Outlays', 'Description',
      'Contract Award Type', 'Start Date', 'End Date',
      'Awarding Agency', 'Awarding Sub Agency',
      'Awarding Office Code', 'Awarding Office Name',
      'Funding Agency', 'Funding Office Code', 'Funding Office Name',
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

// ─── Fetch w/ retry ────────────────────────────────────────────────────────
async function fetchPage(filterBlock, page, attempt = 1) {
  try {
    const res = await fetch(`${USA_BASE}/search/spending_by_award/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payloadForPage(filterBlock, page)),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`USAspending ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  } catch (err) {
    if (attempt >= 4) throw err;
    const delay = Math.min(2000 * Math.pow(2, attempt - 1), 20_000);
    log('warn', 'fetchPage retry', { page, attempt, delay_ms: delay, error: String(err).slice(0, 200) });
    await new Promise((r) => setTimeout(r, delay));
    return fetchPage(filterBlock, page, attempt + 1);
  }
}

// ─── POST page to api-worker (with view_id) ────────────────────────────────
async function postPage(viewId, runId, pageData, finalize, metadata) {
  const body = { run_id: runId, view_id: viewId, response: pageData, finalize, metadata };
  if (DRY) {
    log('info', 'dry-run skipping POST', { view_id: viewId, finalize, size: pageData?.results?.length ?? 0 });
    return { run_id: runId ?? -1, upserted: 0, failed: 0 };
  }
  const res = await fetch(`${API}/import/awards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// ─── Pull views catalog from worker ────────────────────────────────────────
async function loadViews() {
  const res = await fetch(`${API}/sidecar/views`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`/sidecar/views ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  let views = data.results || [];
  if (ONLY_VIEW) views = views.filter((v) => v.view_id === ONLY_VIEW);
  return views;
}

// ─── Ingest a single view ──────────────────────────────────────────────────
async function ingestView(view) {
  const {
    filterBlock,
    contract_end_since, contract_end_until,
    action_date_since,  action_date_until,
  } = buildUsaspendingFilters(view.filters || {});
  log('info', 'view start', {
    view_id: view.view_id, name: view.name,
    contract_end_since, contract_end_until,
    action_date_since,  action_date_until,
    filterBlock,
  });

  let runId;
  let page = 1;
  let totalUpserted = 0;
  let totalFailed = 0;
  const metadata = {
    source: 'oracle-sidecar',
    view_id: view.view_id, view_name: view.name,
    contract_end_since, contract_end_until,
    action_date_since,  action_date_until,
    host: process.env.HOSTNAME ?? 'oracle-vm',
  };

  while (page <= MAX_PAGES) {
    const t0 = Date.now();
    const data = await fetchPage(filterBlock, page);
    const count = data.results?.length ?? 0;
    const hasNext = data.page_metadata?.hasNext ?? false;
    log('info', 'page fetched', { view_id: view.view_id, page, count, ms: Date.now() - t0 });

    const up = await postPage(view.view_id, runId, data, false, metadata);
    runId = up.run_id;
    totalUpserted += up.upserted ?? 0;
    totalFailed   += up.failed   ?? 0;
    log('info', 'page upserted', {
      view_id: view.view_id, page, run_id: runId,
      upserted: up.upserted, failed: up.failed, running_total: totalUpserted,
    });

    if (!hasNext || count < PAGE_SIZE) break;
    page++;
    await new Promise((r) => setTimeout(r, PACE_MS));
  }

  // Finalize the run (no body needed, just a flag).
  await postPage(view.view_id, runId, null, true, metadata);
  log('info', 'view complete', {
    view_id: view.view_id, name: view.name,
    run_id: runId, total_upserted: totalUpserted, total_failed: totalFailed,
  });
}

// ─── Main ──────────────────────────────────────────────────────────────────
(async () => {
  log('info', 'sidecar start', { api: API, max_pages_per_view: MAX_PAGES, only_view: ONLY_VIEW, dry: DRY });

  let views;
  try {
    views = await loadViews();
  } catch (err) {
    log('error', 'failed to load views catalog', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }

  if (views.length === 0) {
    log('warn', 'no enabled views — nothing to ingest', { only_view: ONLY_VIEW });
    process.exit(0);
  }

  log('info', 'views to ingest', { count: views.length, names: views.map((v) => v.name) });

  let anyFailed = false;
  for (const view of views) {
    try {
      await ingestView(view);
    } catch (err) {
      anyFailed = true;
      log('error', 'view failed', { view_id: view.view_id, name: view.name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  log('info', 'sidecar end', { failed: anyFailed });
  process.exit(anyFailed ? 1 : 0);
})();
