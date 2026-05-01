#!/usr/bin/env node
// =============================================================================
// AwardLens — local SAM Entity vendor enrichment.
//
// Run from your laptop with a fresh SAM API key (separate quota from VM).
// Uses Node 20+ built-in fetch — no npm install needed.
//
// USAGE:
//   INGEST_TOKEN="..." API_BASE="https://api-worker.algocrat.workers.dev" \
//     SAM_API_KEY="SAM-6099884c-..." \
//     node tools/enrich-vendors-local.mjs
//
// Optional env:
//   BATCH_SIZE     — vendors per worker fetch (default 50)
//   PACE_MS        — sleep between SAM calls (default 1500)
//   MAX_VENDORS    — stop after N successful enrichments (default Infinity)
//   DRY_RUN        — set "1" to fetch + log without posting back to worker
//
// What it does:
//   1. GET /sidecar/vendors/needing-sam-enrich (list of vendors with UEI but
//      no recent SAM enrichment)
//   2. For each: query api.sam.gov/entity-information/v4/entities?ueiSAM=...
//   3. Map response → cage_code, business_types, sam_status, sam_expires_at,
//      vendor_naics_codes
//   4. POST /sidecar/vendors/sam-enrich with batched updates
//   5. Log progress, exit cleanly on quota exhaustion
// =============================================================================

const env = process.env;

function need(name) {
  const v = env[name];
  if (!v) { console.error(`ERROR: env var ${name} is required`); process.exit(1); }
  return v;
}

const API         = need('API_BASE').replace(/\/$/, '');
const TOKEN       = need('INGEST_TOKEN');
const SAM_KEY     = need('SAM_API_KEY');

const BATCH_SIZE  = Number(env.BATCH_SIZE  ?? 50);
const PACE_MS     = Number(env.PACE_MS     ?? 1500);
const MAX_VENDORS = Number(env.MAX_VENDORS ?? Infinity);
const DRY_RUN     = (env.DRY_RUN ?? '') === '1';

const SAM_BASE = 'https://api.sam.gov/entity-information/v4/entities';

const log = (level, msg, extra = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Worker calls ───────────────────────────────────────────────────────────

async function fetchBatchFromWorker() {
  const url = `${API}/sidecar/vendors/needing-sam-enrich?limit=${BATCH_SIZE}&max_age_days=180`;
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
  const r = await fetch(`${API}/sidecar/vendors/sam-enrich`, {
    method: 'POST',
    headers: {
      'content-type':  'application/json',
      'authorization': `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ updates }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`worker POST ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// ─── SAM v4 Entity API ──────────────────────────────────────────────────────
// Response shape (verified from a real Boeing query 2026-05-01):
//   { totalRecords: N,
//     entityData: [
//       { entityRegistration: { ueiSAM, cageCode, legalBusinessName,
//                                registrationStatus, registrationExpirationDate,
//                                dnbOpenData, ... },
//         coreData: { businessTypes: { businessTypeList: [{ businessTypeCode,
//                                                            businessTypeDesc }] },
//                     physicalAddress: {...} },
//         assertions: { goodsAndServices: { primaryNaics,
//                                            naicsList: [{ naicsCode,
//                                                          naicsDescription,
//                                                          sbaSmallBusiness }] } },
//         pointsOfContact: {...} } ] }
//
// IMPORTANT: entityRegistration is at TOP LEVEL, not under coreData. The
// production sidecar's old code looked under coreData and got nothing →
// every vendor was incorrectly stamped "Not Found". Fixed here.

async function fetchEntity(uei, attempt = 1) {
  const url = new URL(SAM_BASE);
  url.searchParams.set('api_key', SAM_KEY);
  url.searchParams.set('ueiSAM',  uei);

  let status = 0;
  try {
    const r = await fetch(url, {
      headers: { Accept: '*/*' },
      signal:  AbortSignal.timeout(30_000),
    });
    status = r.status;
    if (r.status === 429) {
      const txt = await r.text();
      let parsed = null; try { parsed = JSON.parse(txt); } catch {}
      if (parsed?.code === '900804' || /quota/i.test(parsed?.message ?? '')) {
        const e = new Error('SAM quota exhausted');
        e.quotaExhausted = true;
        throw e;
      }
      throw new Error('SAM transient 429');
    }
    if (r.status === 404) return null;
    if (r.status >= 500) throw new Error(`SAM ${r.status}`);
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`SAM ${r.status}: ${body.slice(0, 200)}`);
    }
    const data = await r.json();
    return (data?.entityData ?? [])[0] ?? null;
  } catch (err) {
    if (err && err.quotaExhausted) throw err;
    if (attempt >= 3) {
      log('warn', 'entity fetch giving up', { uei, error: String(err).slice(0, 200) });
      return null;
    }
    const base = status === 429 ? 30_000 : 1500;
    const delay = Math.min(base * Math.pow(2, attempt - 1), 60_000);
    await sleep(delay);
    return fetchEntity(uei, attempt + 1);
  }
}

function mapEntity(entity, vendor) {
  if (!entity) {
    return {
      vendor_id:          vendor.vendor_id,
      cage_code:          null,
      business_types:     null,
      sam_status:         'Not Found',
      sam_expires_at:     null,
      vendor_naics_codes: null,
    };
  }
  const reg = entity.entityRegistration ?? {};
  const businessTypes = entity?.coreData?.businessTypes?.businessTypeList ?? [];
  const naicsList = entity?.assertions?.goodsAndServices?.naicsList ?? [];

  const bizTypeStr = businessTypes
    .map((b) => (b?.businessTypeDesc || b?.businessTypeCode || '').toString().trim())
    .filter(Boolean)
    .join('|');

  const naicsStr = naicsList
    .map((n) => n?.naicsCode)
    .filter(Boolean)
    .join('|');

  return {
    vendor_id:          vendor.vendor_id,
    cage_code:          reg.cageCode ?? null,
    business_types:     bizTypeStr || null,
    sam_status:         reg.registrationStatus ?? null,
    sam_expires_at:     (reg.registrationExpirationDate ?? '').slice(0, 10) || null,
    vendor_naics_codes: naicsStr || null,
  };
}

// ─── Main loop ─────────────────────────────────────────────────────────────

async function processOne(row) {
  if (!row?.uei) return null;
  const entity = await fetchEntity(row.uei);
  return mapEntity(entity, row);
}

async function runBatch() {
  const rows = await fetchBatchFromWorker();
  if (rows.length === 0) {
    log('info', 'no vendors need enrichment');
    return { processed: 0, applied: 0 };
  }
  log('info', 'batch start', { count: rows.length });
  const updates = [];
  let foundCount = 0;
  for (const row of rows) {
    try {
      const u = await processOne(row);
      if (u) {
        updates.push(u);
        if (u.sam_status && u.sam_status !== 'Not Found') foundCount += 1;
      }
    } catch (err) {
      if (err && err.quotaExhausted) {
        log('error', 'quota exhausted, posting partial + stopping');
        if (updates.length > 0) {
          try { await postBack(updates); } catch (e) { log('warn', 'final postback failed', { error: String(e).slice(0, 200) }); }
        }
        process.exit(0);
      }
      log('warn', 'row failed', { vendor_id: row?.vendor_id, error: String(err).slice(0, 200) });
    }
    await sleep(PACE_MS);
  }
  let appliedCount = 0;
  if (updates.length > 0) {
    const result = await postBack(updates);
    appliedCount = result?.applied ?? 0;
    log('info', 'batch done', {
      processed: updates.length,
      found_in_sam: foundCount,
      not_found: updates.length - foundCount,
      accepted: result?.accepted ?? 0,
      applied: appliedCount,
    });
  } else {
    log('warn', 'batch produced no updates');
  }
  return { processed: updates.length, applied: appliedCount };
}

(async () => {
  log('info', 'enrich-vendors-local start', {
    api: API, sam: SAM_BASE, batch_size: BATCH_SIZE, pace_ms: PACE_MS,
    dry_run: DRY_RUN, max_vendors: MAX_VENDORS,
  });

  let totalApplied = 0;
  let consecutiveZero = 0;
  while (totalApplied < MAX_VENDORS) {
    const { processed, applied } = await runBatch();
    totalApplied += applied;
    if (processed === 0) {
      consecutiveZero += 1;
      if (consecutiveZero >= 2) {
        log('info', 'two empty batches in a row — done');
        break;
      }
      await sleep(5000);
    } else {
      consecutiveZero = 0;
    }
  }
  log('info', 'enrich-vendors-local complete', { total_applied: totalApplied });
})().catch((err) => {
  log('error', 'fatal', { error: String(err).slice(0, 300), stack: String(err?.stack ?? '').slice(0, 800) });
  process.exit(1);
});
