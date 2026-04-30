#!/usr/bin/env node
// =============================================================================
// Oracle Cloud sidecar — Description + mod-history enrichment
//
// For each award still missing description_long / mod_history (or whose
// data is older than max-age-days), pulls:
//
//   • /awards/{generated_internal_id}/   → award.description_long
//   • /awards/transactions/              → chronological mod_history
//
// And POSTs the results back to the worker via /sidecar/awards/description-enrich.
//
// Modes:
//   default            — process up to MAX_BATCHES_PER_RUN batches (timer use)
//   --backfill         — keep looping until the worker says no rows need work
//   --dry-run          — fetch + log; skip the worker postback
//
// Environment (loaded by systemd EnvironmentFile):
//   API_BASE         (required) https://api-worker.<sub>.workers.dev
//   INGEST_TOKEN     (required) shared secret matching worker's INGEST_TOKEN
//   ENRICH_BATCH_SIZE       integer (default 50)
//   ENRICH_MAX_BATCHES_RUN  integer (default 10) — ignored in --backfill
//   ENRICH_PACE_MS          integer (default 600) — sleep between awards
//   ENRICH_MAX_AGE_DAYS     integer (default 90)  — refresh threshold
// =============================================================================

const USA_BASE = 'https://api.usaspending.gov/api/v2';
const env = process.env;

function require_env(name) {
  const v = env[name];
  if (!v) { console.error(`ERROR: env var ${name} is required`); process.exit(1); }
  return v;
}

const API   = require_env('API_BASE').replace(/\/$/, '');
const TOKEN = require_env('INGEST_TOKEN');

const BATCH_SIZE        = Number(env.ENRICH_BATCH_SIZE       || 50);
const MAX_BATCHES_RUN   = Number(env.ENRICH_MAX_BATCHES_RUN  || 10);
const PACE_MS           = Number(env.ENRICH_PACE_MS          || 600);
const MAX_AGE_DAYS      = Number(env.ENRICH_MAX_AGE_DAYS     || 90);

const BACKFILL = process.argv.includes('--backfill');
const DRY      = process.argv.includes('--dry-run');

function log(level, msg, extra = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));
}

// ─── Worker calls ───────────────────────────────────────────────────────────

async function fetchBatchFromWorker() {
  const url = `${API}/sidecar/awards/needing-description-enrich`
    + `?limit=${BATCH_SIZE}&max_age_days=${MAX_AGE_DAYS}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`worker fetch ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.results ?? [];
}

async function postBackToWorker(updates) {
  if (DRY) {
    log('info', 'dry-run: skip postback', { count: updates.length });
    return { count: 0 };
  }
  const res = await fetch(`${API}/sidecar/awards/description-enrich`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      'Authorization': `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ updates }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`postback ${res.status}: ${t.slice(0, 200)}`);
  }
  return await res.json();
}

// ─── USAspending fetches ────────────────────────────────────────────────────

async function fetchAwardDescription(generatedInternalId, attempt = 1) {
  try {
    const res = await fetch(
      `${USA_BASE}/awards/${encodeURIComponent(generatedInternalId)}/`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`detail ${res.status}`);
    const data = await res.json();
    const d = data?.description ?? data?.latest_transaction_contract_data?.description ?? null;
    if (typeof d !== 'string') return null;
    return d.replace(/\s+/g, ' ').trim() || null;
  } catch (err) {
    if (attempt >= 3) {
      log('warn', 'description fetch giving up', { id: generatedInternalId, error: String(err).slice(0, 120) });
      return null;
    }
    await new Promise((r) => setTimeout(r, 1000 * attempt));
    return fetchAwardDescription(generatedInternalId, attempt + 1);
  }
}

async function fetchAwardTransactions(generatedInternalId, attempt = 1) {
  try {
    const res = await fetch(`${USA_BASE}/awards/transactions/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept':       'application/json',
      },
      body: JSON.stringify({
        award_id: generatedInternalId,
        limit:    100,
        page:     1,
        sort:     'action_date',
        order:    'asc',
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`transactions ${res.status}`);
    const data = await res.json();
    return Array.isArray(data?.results) ? data.results : [];
  } catch (err) {
    if (attempt >= 3) {
      log('warn', 'transactions fetch giving up', { id: generatedInternalId, error: String(err).slice(0, 120) });
      return null;
    }
    await new Promise((r) => setTimeout(r, 1000 * attempt));
    return fetchAwardTransactions(generatedInternalId, attempt + 1);
  }
}

function buildModHistory(transactions) {
  if (!Array.isArray(transactions) || transactions.length === 0) return null;
  // USAspending may already have returned in action_date asc order, but be
  // defensive — we want a stable chronological narrative regardless.
  const sorted = [...transactions].sort((a, b) => {
    const da = String(a?.action_date ?? '');
    const db = String(b?.action_date ?? '');
    return da.localeCompare(db);
  });

  const seenSig = new Set();   // dedupe identical adjacent rows (USAspending
                               //   sometimes returns the same mod twice)
  const lines = [];
  for (const t of sorted) {
    const date = String(t?.action_date ?? '').slice(0, 10) || '????-??-??';
    const mod  = String(
      t?.modification_number
      ?? t?.mod_number
      ?? t?.transaction_number
      ?? '0',
    ).slice(0, 16);
    const rawDesc = String(
      t?.description
      ?? t?.transaction_description
      ?? '',
    );
    const desc = rawDesc.replace(/\s+/g, ' ').trim().slice(0, 500);
    const sig = `${date}|${mod}|${desc.slice(0, 80)}`;
    if (seenSig.has(sig)) continue;
    seenSig.add(sig);
    lines.push(`[${date}] MOD ${mod} — ${desc || '(no description)'}`);
  }
  if (lines.length === 0) return null;
  return lines.join('\n---\n');
}

// ─── Per-award processing ────────────────────────────────────────────────────

async function enrichOne(row) {
  const id = row.generated_internal_id;
  if (!id) return null;
  const [desc, txns] = await Promise.all([
    fetchAwardDescription(id),
    fetchAwardTransactions(id),
  ]);
  const mod_history = buildModHistory(txns);
  // If both fields came back null, the upstream fetches failed (network
  // outage, IPv6 DNS issue, etc.). Don't stamp this row — returning null
  // keeps it eligible for the next sweep instead of marking it "enriched"
  // with empty data and never being retried.
  if (desc == null && mod_history == null) return null;
  return {
    award_id:         row.award_id,
    description_long: desc,
    mod_history,
  };
}

async function runBatch() {
  const rows = await fetchBatchFromWorker();
  if (rows.length === 0) {
    log('info', 'no rows need enrichment');
    return 0;
  }
  log('info', 'batch start', { count: rows.length });
  const updates = [];
  for (const row of rows) {
    try {
      const u = await enrichOne(row);
      if (u) updates.push(u);
    } catch (err) {
      log('warn', 'enrich row failed', { award_id: row?.award_id, error: String(err).slice(0, 200) });
    }
    await new Promise((r) => setTimeout(r, PACE_MS));
  }
  if (updates.length > 0) {
    const result = await postBackToWorker(updates);
    log('info', 'batch done', { processed: updates.length, applied: result?.count ?? 0 });
  } else {
    log('warn', 'batch produced no updates');
  }
  return updates.length;
}

async function main() {
  const limit = BACKFILL ? Infinity : MAX_BATCHES_RUN;
  let total = 0;
  for (let i = 0; i < limit; i++) {
    const n = await runBatch();
    total += n;
    if (n === 0) break;
  }
  log('info', 'enrichment complete', { total, mode: BACKFILL ? 'backfill' : 'incremental', dry: DRY });
}

main().catch((err) => {
  log('error', 'enrichment failed', { error: String(err).slice(0, 300), stack: String(err?.stack ?? '').slice(0, 800) });
  process.exit(1);
});
