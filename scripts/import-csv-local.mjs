#!/usr/bin/env node
// =============================================================================
// Import a USAspending Custom Award Data CSV into the warehouse.
//
// Use this when the live API path is blocked (persistent 525 from Cloudflare
// edge to api.usaspending.gov) or when you want bulk historical data faster
// than paginating the Search API.
//
// Workflow:
//   1. Download a Custom Award Data CSV from
//      https://www.usaspending.gov/download_center/custom_award_data
//   2. Unzip it locally.
//   3. Run this script against the unzipped CSV.
//
// Usage (from repo root):
//   node scripts/import-csv-local.mjs --file=PrimeAwardSummariesContracts_1.csv
//   node scripts/import-csv-local.mjs --file=awards.csv --batch=100
//
// Options:
//   --file=PATH           Path to the CSV file (required)
//   --api-base=URL        API worker URL (default: algocrat subdomain)
//   --batch=N             Rows per POST (default: 100, keep ≤ 500)
//   --limit=N             Stop after processing N rows (debug)
//
// The script maps Custom Award Data column names to the Search API shape
// that /import/awards already understands, so no server-side changes needed.
// =============================================================================

import { readFileSync, statSync } from 'node:fs';

const DEFAULT_API_BASE = 'https://api-worker.algocrat.workers.dev';

function parseArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const args = parseArgs();
if (!args.file) {
  console.error('Missing --file=PATH. See top of script for usage.');
  process.exit(1);
}
const API = (args['api-base'] || DEFAULT_API_BASE).replace(/\/$/, '');
const BATCH = Math.max(1, Math.min(Number(args.batch || 100), 500));
const LIMIT = args.limit ? Number(args.limit) : Infinity;

// ─── RFC 4180 CSV parser (streaming-friendly) ──────────────────────────────
function* parseCsv(text) {
  let field = '';
  let row = [];
  let inQuotes = false;
  let i = 0;
  const len = text.length;
  while (i < len) {
    const ch = text.charCodeAt(i);
    if (inQuotes) {
      if (ch === 34) {
        if (i + 1 < len && text.charCodeAt(i + 1) === 34) { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += text[i]; i++; continue;
    }
    if (ch === 34) { inQuotes = true; i++; continue; }
    if (ch === 44) { row.push(field); field = ''; i++; continue; }
    if (ch === 13) { i++; continue; }
    if (ch === 10) { row.push(field); yield row; field = ''; row = []; i++; continue; }
    field += text[i]; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); yield row; }
}

// ─── Column name candidates (USAspending has varied these over time) ───────
const COLS = {
  external_id:     ['contract_award_unique_key', 'assistance_award_unique_key', 'award_unique_key'],
  piid:            ['award_id_piid', 'fain', 'award_id'],
  parent_piid:     ['parent_award_id_piid'],
  award_type:      ['award_type_code', 'award_type', 'type_of_contract_pricing'],
  description:     ['prime_award_base_transaction_description', 'award_description', 'transaction_description'],
  current_value:   ['current_total_value_of_award', 'total_obligated_amount', 'federal_action_obligation'],
  obligated:       ['total_outlayed_amount_for_overall_award', 'total_dollars_obligated'],
  start_date:      ['period_of_performance_start_date'],
  end_date:        ['period_of_performance_current_end_date'],
  last_modified:   ['last_modified_date'],
  awarding_agency: ['awarding_agency_name'],
  awarding_sub:    ['awarding_sub_agency_name'],
  funding_agency:  ['funding_agency_name'],
  recipient_uei:   ['recipient_uei'],
  recipient_id:    ['recipient_id'],  // sometimes available
  recipient_name:  ['recipient_name'],
  recipient_state: ['recipient_state_code'],
  naics_code:      ['naics_code', 'naics'],
  naics_desc:      ['naics_description'],
  psc_code:        ['product_or_service_code', 'psc'],
  psc_desc:        ['product_or_service_code_description', 'psc_description'],
  pop_state:       ['primary_place_of_performance_state_code'],
  pop_country:     ['primary_place_of_performance_country_code'],
};

function findCol(headers, candidates) {
  const lower = headers.map((h) => h.toLowerCase());
  for (const c of candidates) {
    const idx = lower.indexOf(c.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

function mapHeaderIndexes(headers) {
  const idx = {};
  for (const [key, candidates] of Object.entries(COLS)) {
    idx[key] = findCol(headers, candidates);
  }
  return idx;
}

// Translate a CSV row → Search API result shape (what our /import endpoint expects)
function rowToSearchResult(row, idx) {
  const g = (key) => (idx[key] >= 0 ? row[idx[key]] : undefined);
  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const external_id = g('external_id') || g('piid');
  if (!external_id) return null;

  return {
    'generated_internal_id': external_id,
    'Award ID':              g('piid') ?? null,
    'Recipient Name':        g('recipient_name') ?? null,
    'Recipient UEI':         g('recipient_uei') ?? null,
    'Award Amount':          num(g('current_value')),
    'Total Outlays':         num(g('obligated')),
    'Description':           g('description') ?? null,
    'Contract Award Type':   g('award_type') ?? null,
    'Start Date':            g('start_date') ?? null,
    'End Date':              g('end_date') ?? null,
    'Last Modified Date':    g('last_modified') ?? null,
    'Awarding Agency':       g('awarding_agency') ?? null,
    'Awarding Sub Agency':   g('awarding_sub') ?? null,
    'Funding Agency':        g('funding_agency') ?? null,
    'NAICS': g('naics_code') ? { code: g('naics_code'), description: g('naics_desc') ?? '' } : null,
    'PSC':   g('psc_code')   ? { code: g('psc_code'),   description: g('psc_desc') ?? '' }   : null,
    'recipient_id':          g('recipient_id') ?? null,
    'Place of Performance State Code':   g('pop_state') ?? null,
    'Place of Performance Country Code': g('pop_country') ?? null,
  };
}

async function postBatch(runId, results, finalize = false) {
  const body = {
    run_id: runId,
    response: { results, page_metadata: { page: 0, hasNext: false } },
    finalize,
    metadata: { source: 'csv-import', file: args.file },
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
  const fileInfo = statSync(args.file);
  console.log(`▸ CSV import: ${args.file} (${(fileInfo.size / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`  API: ${API}`);
  console.log(`  Batch size: ${BATCH}\n`);

  // Note: for truly enormous files (>500 MB), load as buffer may be slow.
  // The import endpoint is chunked, so we're fine for most Custom Award Data
  // downloads (typically 10-200 MB per file).
  const text = readFileSync(args.file, 'utf8');
  const iter = parseCsv(text);
  const first = iter.next();
  if (first.done) { console.error('Empty CSV'); process.exit(1); }
  const headers = first.value;
  const idx = mapHeaderIndexes(headers);

  // Basic sanity
  const unmatched = Object.entries(idx).filter(([, i]) => i < 0).map(([k]) => k);
  if (unmatched.length > 0) {
    console.log(`  Columns not found in CSV: ${unmatched.join(', ')}`);
    console.log(`  (these fields will be blank — import will still work)\n`);
  }

  let runId;
  let pending = [];
  let total = 0;
  let totalUpserted = 0;
  let totalFailed = 0;
  let rowNum = 0;

  try {
    for (const row of iter) {
      rowNum++;
      if (rowNum > LIMIT) break;
      const mapped = rowToSearchResult(row, idx);
      if (!mapped) continue;
      pending.push(mapped);

      if (pending.length >= BATCH) {
        const up = await postBatch(runId, pending);
        runId = up.run_id;
        total += pending.length;
        totalUpserted += up.upserted;
        totalFailed += up.failed || 0;
        const fail = up.failed ? `, failed=${up.failed}` : '';
        process.stdout.write(`\r  rows processed: ${total.toString().padStart(6)} (upserted=${totalUpserted}${fail}, run_id=${runId})`);
        if (up.failures?.length) {
          console.log('');
          for (const f of up.failures.slice(0, 3)) {
            console.log(`    ⚠ ${f.award.slice(0, 40)}: ${f.reason}`);
          }
        }
        pending = [];
      }
    }

    // Final flush + finalize
    const up = await postBatch(runId, pending, true);
    runId = up.run_id;
    total += pending.length;
    totalUpserted += up.upserted;
    totalFailed += up.failed || 0;
    console.log(`\r  rows processed: ${total.toString().padStart(6)} (upserted=${totalUpserted}, failed=${totalFailed}, run_id=${runId})`);
    console.log(`\n✓ Done. run_id=${runId}, total upserted=${totalUpserted}`);
  } catch (e) {
    console.error(`\n✗ Failed at row ~${rowNum}: ${e.message}`);
    if (runId) {
      try { await fetch(`${API}/runs/${runId}/cancel`, { method: 'POST' }); } catch { /* noop */ }
    }
    process.exit(1);
  }
})();
