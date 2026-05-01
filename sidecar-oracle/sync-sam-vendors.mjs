#!/usr/bin/env node
// =============================================================================
// SAM.gov Entity Registration enrichment for vendors.
//
// For each vendor with a UEI but no recent SAM enrichment, queries
// https://api.sam.gov/entity-information/v3/entities?ueiSAM=<uei> and
// extracts: CAGE code, business types, registration status, expiration,
// self-certified NAICS. POSTs results in batches to the worker.
//
// Env (loaded by systemd EnvironmentFile):
//   API_BASE       required
//   INGEST_TOKEN   required
//   SAM_API_KEY    required
//   VENDOR_BATCH   optional — default 50 per worker fetch
//   VENDOR_PACE_MS optional — default 2000 (between SAM calls)
//   VENDOR_BATCHES optional — default 10 (max worker fetches per run)
//   VENDOR_MAX_AGE_DAYS optional — default 180
// =============================================================================

const env = process.env;
const require_env = (k) => {
  if (!env[k]) { console.error(`ERROR: env var ${k} required`); process.exit(1); }
  return env[k];
};

const API   = require_env('API_BASE').replace(/\/$/, '');
const TOKEN = require_env('INGEST_TOKEN');
const KEY   = require_env('SAM_API_KEY');

const BATCH_SIZE   = Number(env.VENDOR_BATCH ?? 50);
const PACE_MS      = Number(env.VENDOR_PACE_MS ?? 2000);
const MAX_BATCHES  = Number(env.VENDOR_BATCHES ?? 10);
const MAX_AGE_DAYS = Number(env.VENDOR_MAX_AGE_DAYS ?? 180);
const BACKFILL     = process.argv.includes('--backfill');

const SAM_BASE = 'https://api.sam.gov/entity-information/v4/entities';

const log = (level, msg, extra = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));

// ─── Worker calls ───────────────────────────────────────────────────────────

async function fetchBatchFromWorker() {
  const url = `${API}/sidecar/vendors/needing-sam-enrich?limit=${BATCH_SIZE}&max_age_days=${MAX_AGE_DAYS}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`worker GET ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return data.results ?? [];
}

async function postBack(updates) {
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

// ─── SAM Entity API ─────────────────────────────────────────────────────────

async function fetchEntity(uei, attempt = 1) {
  const url = new URL(SAM_BASE);
  url.searchParams.set('api_key', KEY);
  url.searchParams.set('ueiSAM',  uei);
  url.searchParams.set('samRegistered', 'Yes');

  let status = 0;
  try {
    const r = await fetch(url, {
      headers: { Accept: '*/*' },
      signal:  AbortSignal.timeout(30_000),
    });
    status = r.status;
    if (r.status === 429) {
      const text = await r.text();
      let parsed = null; try { parsed = JSON.parse(text); } catch {}
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
    const list = data?.entityData ?? [];
    return list[0] ?? null;
  } catch (err) {
    if (err && err.quotaExhausted) throw err;
    if (attempt >= 3) {
      log('warn', 'entity fetch giving up', { uei, error: String(err).slice(0, 200) });
      return null;
    }
    const base = status === 429 ? 30_000 : 1500;
    const delay = Math.min(base * Math.pow(2, attempt - 1), 60_000);
    await new Promise((r) => setTimeout(r, delay));
    return fetchEntity(uei, attempt + 1);
  }
}

// SAM v4 entity payload — verified live response shape (2026-05-01):
//   {
//     entityRegistration: { ueiSAM, cageCode, legalBusinessName,
//                            registrationStatus, registrationExpirationDate,
//                            samRegistered, dnbOpenData, ... },
//     coreData: {
//       businessTypes: { businessTypeList: [{ businessTypeCode,
//                                              businessTypeDesc }] },
//       physicalAddress, ...
//     },
//     assertions: {
//       goodsAndServices: {
//         primaryNaics: "336411",
//         naicsList: [{ naicsCode, naicsDescription, sbaSmallBusiness }]
//       }
//     },
//     pointsOfContact: { ... }
//   }
//
// CRITICAL: entityRegistration is at the TOP LEVEL, not under coreData.
// Earlier versions of this code looked under coreData.entityRegistration
// and got an empty {}, then mapped null fields → every vendor stamped
// 'Not Found'. Bug found by probing live API on 2026-05-01.
function mapEntity(entity, vendor) {
  if (!entity) return null;
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
    vendor_id:            vendor.vendor_id,
    cage_code:            reg.cageCode ?? null,
    business_types:       bizTypeStr || null,
    sam_status:           reg.registrationStatus ?? null,
    sam_expires_at:       (reg.registrationExpirationDate ?? '').slice(0, 10) || null,
    vendor_naics_codes:   naicsStr || null,
  };
}

// ─── Per-row processing ─────────────────────────────────────────────────────

async function processRow(row) {
  if (!row?.uei) return null;
  const entity = await fetchEntity(row.uei);
  if (!entity) {
    // Vendor not in SAM (or expired/inactive). Still stamp the row so we
    // don't keep retrying — but with sam_status='Not Found' for visibility.
    return {
      vendor_id:          row.vendor_id,
      cage_code:          null,
      business_types:     null,
      sam_status:         'Not Found',
      sam_expires_at:     null,
      vendor_naics_codes: null,
    };
  }
  return mapEntity(entity, row);
}

async function runBatch() {
  const rows = await fetchBatchFromWorker();
  if (rows.length === 0) {
    log('info', 'no vendors need enrichment');
    return 0;
  }
  log('info', 'batch start', { count: rows.length });
  const updates = [];
  for (const row of rows) {
    try {
      const u = await processRow(row);
      if (u) updates.push(u);
    } catch (err) {
      if (err && err.quotaExhausted) {
        log('error', 'quota exhausted, stopping', { error: String(err).slice(0, 200) });
        if (updates.length > 0) {
          try { await postBack(updates); } catch (e) { log('warn', 'postback after quota failed', { error: String(e).slice(0, 200) }); }
        }
        process.exit(0);
      }
      log('warn', 'row failed', { vendor_id: row?.vendor_id, error: String(err).slice(0, 200) });
    }
    await new Promise((r) => setTimeout(r, PACE_MS));
  }
  if (updates.length > 0) {
    const result = await postBack(updates);
    log('info', 'batch done', { processed: updates.length, accepted: result?.accepted, applied: result?.applied });
    return result?.applied ?? 0;
  }
  log('warn', 'batch produced no updates');
  return 0;
}

(async () => {
  const limit = BACKFILL ? Infinity : MAX_BATCHES;
  let total = 0;
  let consecutiveZero = 0;
  for (let i = 0; i < limit; i++) {
    const n = await runBatch();
    total += n;
    if (n === 0) {
      consecutiveZero += 1;
      if (consecutiveZero >= 3) break;
      await new Promise((r) => setTimeout(r, 5000));
    } else {
      consecutiveZero = 0;
    }
  }
  log('info', 'enrichment complete', { total, mode: BACKFILL ? 'backfill' : 'incremental' });
})().catch((err) => {
  log('error', 'failed', { error: String(err).slice(0, 300) });
  process.exit(1);
});
