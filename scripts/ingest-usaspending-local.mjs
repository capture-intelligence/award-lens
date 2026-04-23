#!/usr/bin/env node
// =============================================================================
// Local USAspending ingestion.
//
// Runs ON YOUR MACHINE — not on Cloudflare edge — so it bypasses the
// api.usaspending.gov 525 TLS issue that the Workers workflow hits.
//
// Usage (from repo root):
//   node scripts/ingest-usaspending-local.mjs [options]
//
// Options:
//   --api-base=<url>             API worker URL (default: from config.js)
//   --since=YYYY-MM-DD           Start of date range (default: 2024-01-01)
//   --until=YYYY-MM-DD           End of date range (default: 2024-12-31)
//   --max-pages=N                Safety cap (default: 5)
//   --agencies="A,B"             Toptier agency names (comma-separated)
//   --subtier-agencies="A,B"     Subtier/op-div names
//   --keywords="K1,K2"           Keyword filters
//   --naics="123,456"            NAICS codes
//   --psc="R408,Q301"            PSC codes
//   --recipient="Lantana"        Recipient name substring
//   --min-value=N                Minimum award value (USD)
//   --max-value=N                Maximum award value (USD)
//   --award-types="A,B,C,D"      USAspending type codes (default: contracts)
//
// Examples:
//   # NCHHSTP-scoped pull:
//   node scripts/ingest-usaspending-local.mjs \
//     --agencies="Department of Health and Human Services" \
//     --subtier-agencies="Centers for Disease Control and Prevention" \
//     --keywords="NCHHSTP,HIV,tuberculosis" \
//     --min-value=4000000 \
//     --since=2020-01-01 --until=2025-12-31 \
//     --max-pages=10
//
// =============================================================================

const DEFAULT_API_BASE = 'https://api-worker.algocrat.workers.dev';
const USA_BASE = 'https://api.usaspending.gov/api/v2';
const PAGE_SIZE = 100;
const PACE_MS = 1500;

// ─── CLI args ──────────────────────────────────────────────────────────────
function parseArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function splitCsv(s) {
  return (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
}

const args = parseArgs();
const API = (args['api-base'] || DEFAULT_API_BASE).replace(/\/$/, '');
const since = args.since || '2024-01-01';
const until = args.until || '2024-12-31';
const maxPages = Number(args['max-pages'] || 5);

const filters = {};
if (args.agencies)           filters.agencies         = splitCsv(args.agencies);
if (args['subtier-agencies']) filters.subtier_agencies = splitCsv(args['subtier-agencies']);
if (args.keywords)           filters.keywords         = splitCsv(args.keywords);
if (args.naics)              filters.naics_codes      = splitCsv(args.naics);
if (args.psc)                filters.psc_codes        = splitCsv(args.psc);
if (args.recipient)          filters.recipient_search_text = args.recipient;
if (args['min-value'] != null) filters.award_amount_min = Number(args['min-value']);
if (args['max-value'] != null) filters.award_amount_max = Number(args['max-value']);

const awardTypes = args['award-types']
  ? splitCsv(args['award-types'])
  : ['A', 'B', 'C', 'D'];

// ─── Build USAspending payload ─────────────────────────────────────────────
function buildPayload(page) {
  const fb = {
    time_period: [{ start_date: since, end_date: until, date_type: 'action_date' }],
    award_type_codes: awardTypes,
  };
  const agencyObjs = [];
  for (const name of filters.agencies ?? [])
    agencyObjs.push({ type: 'awarding', tier: 'toptier', name });
  for (const name of filters.subtier_agencies ?? [])
    agencyObjs.push({ type: 'awarding', tier: 'subtier', name });
  if (agencyObjs.length) fb.agencies = agencyObjs;
  if (filters.keywords?.length)        fb.keywords = filters.keywords;
  if (filters.naics_codes?.length)     fb.naics_codes = filters.naics_codes;
  if (filters.psc_codes?.length)       fb.psc_codes = filters.psc_codes;
  if (filters.recipient_search_text)   fb.recipient_search_text = [filters.recipient_search_text];
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

// ─── Fetch a single page ───────────────────────────────────────────────────
async function fetchPage(page) {
  const res = await fetch(`${USA_BASE}/search/spending_by_award/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(buildPayload(page)),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`USAspending ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json();
}

// ─── POST a page to the API worker ─────────────────────────────────────────
async function postPage(runId, pageData, finalize = false) {
  const body = {
    run_id: runId,
    response: pageData,
    finalize,
    metadata: { source: 'local-ingest', filters, since, until },
  };
  const res = await fetch(`${API}/import/awards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─── Main ──────────────────────────────────────────────────────────────────
(async () => {
  console.log(`▸ USAspending local ingest`);
  console.log(`  API: ${API}`);
  console.log(`  Window: ${since} → ${until}`);
  console.log(`  Filters:`, JSON.stringify(filters, null, 2).replace(/\n/g, '\n    '));
  console.log(`  Max pages: ${maxPages}\n`);

  let runId;
  let page = 1;
  let total = 0;

  try {
    while (page <= maxPages) {
      const t0 = Date.now();
      const data = await fetchPage(page);
      const count = data.results?.length ?? 0;
      const hasNext = data.page_metadata?.hasNext ?? false;

      process.stdout.write(`  page ${page}: ${count} records (${Date.now() - t0}ms) → `);
      const up = await postPage(runId, data);
      runId = up.run_id;
      total += up.upserted;
      const failedStr = up.failed ? `, failed=${up.failed}` : '';
      console.log(`upserted ${up.upserted}${failedStr} (run_id=${runId}, total=${total})`);
      if (up.failures?.length) {
        for (const f of up.failures.slice(0, 3)) {
          console.log(`    ⚠ ${f.award.slice(0, 40)}: ${f.reason}`);
        }
      }

      if (!hasNext || count < PAGE_SIZE) {
        console.log('\n▸ No more pages. Finalizing…');
        break;
      }
      page++;
      await new Promise((r) => setTimeout(r, PACE_MS));
    }

    // Finalize the run
    await postPage(runId, { results: [] }, true);
    console.log(`\n✓ Done. run_id=${runId}, total upserted=${total}`);
  } catch (e) {
    console.error(`\n✗ Failed: ${e.message}`);
    // Best-effort close of the run
    if (runId) {
      try {
        await fetch(`${API}/runs/${runId}/cancel`, { method: 'POST' });
      } catch { /* ignore */ }
    }
    process.exit(1);
  }
})();
