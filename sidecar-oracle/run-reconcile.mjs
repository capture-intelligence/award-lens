#!/usr/bin/env node
// =============================================================================
// Reconciliation runner (sidecar). Triggers the api-worker's admin endpoints
// to backfill toptier codes (idempotent) then run the per-agency drift audit.
//
// Env:
//   API_BASE        (required)
//   INGEST_TOKEN    (required)
// =============================================================================

const API = (process.env.API_BASE || '').replace(/\/$/, '');
const TOKEN = process.env.INGEST_TOKEN || '';
if (!API || !TOKEN) { console.error('API_BASE and INGEST_TOKEN are required'); process.exit(1); }

const log = (level, msg, extra={}) => console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));

async function call(path) {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new Error(`API ${r.status} on ${path}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

(async () => {
  log('info', 'reconciliation start', { api: API });
  try {
    const t0 = Date.now();
    const backfill = await call('/admin/backfill-toptier-codes');
    log('info', 'toptier backfill', { ms: Date.now() - t0, ...backfill });

    const t1 = Date.now();
    const reconcile = await call('/admin/reconcile');
    log('info', 'reconciliation complete', { ms: Date.now() - t1, ...reconcile });

    process.exit(0);
  } catch (e) {
    log('error', 'reconciliation failed', { error: e.message || String(e) });
    process.exit(1);
  }
})();
