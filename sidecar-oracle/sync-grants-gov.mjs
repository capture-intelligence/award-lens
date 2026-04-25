#!/usr/bin/env node
// =============================================================================
// Grants.gov sync (sidecar). Replaces the Cloudflare Workflow that required
// Workers Paid plan. Pulls active opportunities and posts batches to the
// api-worker's /import/opportunities endpoint.
//
// Env (loaded by systemd EnvironmentFile):
//   API_BASE        (required)  https://api-worker.<sub>.workers.dev
//   INGEST_TOKEN    (required)  shared secret with the worker
//   STATUSES                    comma-sep, default "posted,forecasted"
//   AGENCIES                    comma-sep agency codes (e.g., "HHS-CDC")
//   CFDA                        comma-sep CFDA numbers (e.g., "93.067")
//   KEYWORD                     freeform keyword search
//   MAX_RECORDS                 hard cap (default 5000)
// =============================================================================

const env = process.env;
const API = (env.API_BASE || '').replace(/\/$/, '');
const TOKEN = env.INGEST_TOKEN || '';
if (!API || !TOKEN) { console.error('API_BASE and INGEST_TOKEN are required'); process.exit(1); }

const statuses = (env.STATUSES || 'posted,forecasted').split(',').map(s => s.trim()).filter(Boolean);
const agencies = (env.AGENCIES || '').split(',').map(s => s.trim()).filter(Boolean);
const cfda     = (env.CFDA || '').split(',').map(s => s.trim()).filter(Boolean);
const keyword  = env.KEYWORD || '';
const MAX_RECORDS = Number(env.MAX_RECORDS || 5000);

const log = (level, msg, extra={}) => console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));

async function search(start, rows = 1000) {
  const body = {
    keyword,
    oppStatuses: statuses.join('|'),
    rows,
    startRecordNum: start,
    eligibilities: '',
    agencies: agencies.join('|'),
    aln: cfda.join('|'),
    fundingCategories: '',
    sortBy: 'openDate|desc',
  };
  const r = await fetch('https://api.grants.gov/v1/api/search2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`Grants.gov ${r.status}`);
  const j = await r.json();
  if (j.errorcode !== 0) throw new Error(`Grants.gov errorcode=${j.errorcode}: ${j.msg}`);
  return j.data;
}

async function postBatch(runId, hits, finalize=false) {
  const r = await fetch(`${API}/import/opportunities`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ run_id: runId, hits, finalize }),
  });
  if (!r.ok) throw new Error(`API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

(async () => {
  log('info', 'sync-grants-gov start', { api: API, statuses, agencies, cfda, keyword, max: MAX_RECORDS });
  let runId, total = 0, totalUpserted = 0;
  try {
    let start = 0, page = 1;
    while (total < MAX_RECORDS) {
      const t0 = Date.now();
      const data = await search(start, Math.min(1000, MAX_RECORDS - total));
      const hits = data.oppHits || [];
      log('info', 'page fetched', { page, count: hits.length, hitCount: data.hitCount, ms: Date.now() - t0 });
      if (hits.length === 0) break;
      const r = await postBatch(runId, hits);
      runId = r.run_id;
      total += hits.length;
      totalUpserted += r.upserted;
      log('info', 'page upserted', { page, run_id: runId, upserted: r.upserted, running_total: totalUpserted });
      if (hits.length < 1000 || total >= data.hitCount) break;
      start += hits.length;
      page++;
      await new Promise(res => setTimeout(res, 1500));
    }
    await postBatch(runId, [], true);
    log('info', 'run complete', { run_id: runId, total_upserted: totalUpserted });
    process.exit(0);
  } catch (e) {
    log('error', 'run failed', { run_id: runId, error: e.message || String(e) });
    process.exit(1);
  }
})();
