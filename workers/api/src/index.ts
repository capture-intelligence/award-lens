import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import type { SamEnrichMsg } from '@awards/core';
import { UsaspendingAdapter, buildUpsertStatements } from '@awards/core';
import { buildScheduleStatus } from './schedule.js';

export interface Env {
  DB: D1Database;
  META: KVNamespace;
  SAM_ENRICH_QUEUE: Queue<SamEnrichMsg>;
  SAM_API: Fetcher;
  USASPENDING_WORKFLOW: Workflow;
  SAM_BULK_WORKFLOW: Workflow;
  GRANTS_GOV_WORKFLOW: Workflow;
  /** Optional shared secret; if set, /import/awards requires Authorization: Bearer <token>. */
  INGEST_TOKEN?: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', logger());
app.use('*', prettyJSON());
app.use('*', cors());

// ---------- Health ----------
app.get('/', (c) => c.json({
  service: 'awards-api',
  status: 'ok',
  time: new Date().toISOString(),
}));

app.get('/health', async (c) => {
  const [runCount, lastRun, reconcile] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM ingestion_run').first<{ n: number }>(),
    c.env.DB.prepare(`
      SELECT source_id, status, started_at, finished_at, rows_upserted
      FROM ingestion_run ORDER BY started_at DESC LIMIT 1
    `).first(),
    c.env.META.get('LAST_RECONCILE'),
  ]);
  return c.json({
    runs_total: runCount?.n ?? 0,
    last_run: lastRun,
    last_reconcile: reconcile ? JSON.parse(reconcile) : null,
  });
});

// ---------- Awards ----------

app.get('/awards', async (c) => {
  const q = c.req.query('q');
  const org = c.req.query('awarding_org');
  const vendor = c.req.query('vendor');
  const minValue = Number(c.req.query('min_value') ?? 0);
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 500);

  const filters: string[] = [];
  const params: unknown[] = [];

  if (q) {
    filters.push('(description LIKE ? OR award_piid LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (org) {
    filters.push('awarding_org_name LIKE ?');
    params.push(`%${org}%`);
  }
  if (vendor) {
    filters.push('vendor_name LIKE ?');
    params.push(`%${vendor}%`);
  }
  if (minValue > 0) {
    filters.push('current_value >= ?');
    params.push(minValue);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const sql = `
    SELECT * FROM v_award_current
    ${where}
    ORDER BY current_value DESC NULLS LAST
    LIMIT ?
  `;
  params.push(limit);

  const result = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ count: result.results.length, results: result.results });
});

app.get('/awards/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM v_award_current WHERE award_id = ?')
    .bind(c.req.param('id')).first();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(row);
});

app.get('/awards/expiring/:months', async (c) => {
  const months = Math.min(Number(c.req.param('months') ?? 18), 60);
  const result = await c.env.DB.prepare(`
    SELECT * FROM v_award_current
    WHERE pop_end_date IS NOT NULL
      AND date(pop_end_date) BETWEEN date('now') AND date('now', ?)
    ORDER BY current_value DESC
    LIMIT 500
  `).bind(`+${months} months`).all();
  return c.json({ count: result.results.length, months, results: result.results });
});

// ---------- Vendors ----------

app.get('/vendors', async (c) => {
  const q = c.req.query('q');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 500);
  let sql = 'SELECT * FROM v_vendor_rollup';
  const params: unknown[] = [];
  if (q) { sql += ' WHERE legal_name LIKE ?'; params.push(`%${q}%`); }
  sql += ' ORDER BY total_value DESC LIMIT ?';
  params.push(limit);
  const result = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ count: result.results.length, results: result.results });
});

app.get('/vendors/:idOrUei', async (c) => {
  const id = c.req.param('idOrUei');
  const row = await c.env.DB.prepare(
    'SELECT * FROM v_vendor_rollup WHERE vendor_id = ? OR uei = ? LIMIT 1',
  ).bind(id, id).first();
  if (!row) return c.json({ error: 'not found' }, 404);

  const classifications = await c.env.DB.prepare(
    'SELECT classification, effective_from, effective_to, source_id FROM vendor_classification WHERE vendor_id = ?',
  ).bind((row as { vendor_id: string }).vendor_id).all();

  const topAwards = await c.env.DB.prepare(`
    SELECT award_id, award_piid, current_value, pop_end_date, awarding_org_name
    FROM v_award_current
    WHERE vendor_id = ?
    ORDER BY current_value DESC LIMIT 20
  `).bind((row as { vendor_id: string }).vendor_id).all();

  return c.json({
    vendor: row,
    classifications: classifications.results,
    top_awards: topAwards.results,
  });
});

// ---------- Organizations ----------

app.get('/organizations', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT o.org_id, o.canonical_name, o.short_name, o.org_type,
           COUNT(a.award_id) AS num_awards,
           COALESCE(SUM(a.current_value), 0) AS total_value
    FROM organization o
    LEFT JOIN award a ON a.awarding_org_id = o.org_id
    GROUP BY o.org_id, o.canonical_name, o.short_name, o.org_type
    ORDER BY total_value DESC
    LIMIT 200
  `).all();
  return c.json({ count: result.results.length, results: result.results });
});

// ---------- Ingestion run history ----------

app.get('/runs', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT run_id, source_id, started_at, finished_at, status,
           rows_fetched, rows_upserted, rows_failed,
           watermark_before, watermark_after
    FROM ingestion_run
    ORDER BY started_at DESC
    LIMIT 50
  `).all();
  return c.json({ count: result.results.length, results: result.results });
});

app.get('/runs/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM ingestion_run WHERE run_id = ?')
    .bind(Number(c.req.param('id'))).first();
  if (!row) return c.json({ error: 'not found' }, 404);
  const staging = await c.env.DB.prepare(`
    SELECT staging_id, endpoint, status, r2_key, fetched_at, failure_reason
    FROM staging_raw_record WHERE run_id = ? LIMIT 500
  `).bind(Number(c.req.param('id'))).all();
  return c.json({ run: row, staging: staging.results });
});

// ---------- Aggregations / dashboard data ----------

app.get('/stats/overview', async (c) => {
  const [awards, vendors, orgs, spend] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM award').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM vendor').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM organization').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COALESCE(SUM(current_value), 0) AS total FROM award').first<{ total: number }>(),
  ]);
  return c.json({
    awards: awards?.n ?? 0,
    vendors: vendors?.n ?? 0,
    organizations: orgs?.n ?? 0,
    total_obligated_usd: spend?.total ?? 0,
  });
});

app.get('/stats/top-vendors', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 10), 100);
  const result = await c.env.DB.prepare(`
    SELECT * FROM v_vendor_rollup
    WHERE num_awards > 0
    ORDER BY total_value DESC
    LIMIT ?
  `).bind(limit).all();
  return c.json({ count: result.results.length, results: result.results });
});

app.get('/stats/by-agency', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT o.canonical_name AS agency,
           COUNT(a.award_id) AS num_awards,
           COALESCE(SUM(a.current_value), 0) AS total_value
    FROM award a
    JOIN organization o ON o.org_id = a.awarding_org_id
    GROUP BY o.canonical_name
    ORDER BY total_value DESC
    LIMIT 50
  `).all();
  return c.json({ count: result.results.length, results: result.results });
});

// ---------- Diagnostics: why does USAspending fail from the Worker? ----------
//
// Runs a set of minimal fetch variations against USAspending from the
// Cloudflare edge. Each variation isolates one hypothesis so we can see
// exactly where the 525 is coming from.

app.get('/diag/usaspending', async (c) => {
  const tests: Array<{
    label: string;
    url: string;
    init?: RequestInit;
  }> = [
    {
      label: 'GET /references/toptier_agencies/ — default',
      url: 'https://api.usaspending.gov/api/v2/references/toptier_agencies/',
    },
    {
      label: 'GET /references/toptier_agencies/ — browser UA',
      url: 'https://api.usaspending.gov/api/v2/references/toptier_agencies/',
      init: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'application/json,text/html,*/*',
        },
      },
    },
    {
      label: 'GET /references/toptier_agencies/ — curl UA',
      url: 'https://api.usaspending.gov/api/v2/references/toptier_agencies/',
      init: { headers: { 'User-Agent': 'curl/8.4.0' } },
    },
    {
      label: 'GET usaspending.gov (main site, different origin)',
      url: 'https://usaspending.gov/',
      init: { redirect: 'manual' as RequestRedirect },
    },
    {
      label: 'GET google.com (control — unrelated origin)',
      url: 'https://www.google.com/',
    },
    {
      label: 'GET files.usaspending.gov (bulk archive host — possibly different infra)',
      url: 'https://files.usaspending.gov/',
    },
    {
      label: 'GET files.usaspending.gov/award_data_archive/ (bulk archive listing)',
      url: 'https://files.usaspending.gov/award_data_archive/',
    },
  ];

  const results: Array<Record<string, unknown>> = [];
  for (const t of tests) {
    const started = Date.now();
    try {
      const res = await fetch(t.url, { ...(t.init ?? {}), cf: { cacheTtl: 0 } as any });
      const body = (await res.text()).slice(0, 200);
      results.push({
        label: t.label,
        url: t.url,
        status: res.status,
        ok: res.ok,
        duration_ms: Date.now() - started,
        content_type: res.headers.get('content-type'),
        server: res.headers.get('server'),
        cf_ray: res.headers.get('cf-ray'),
        body_snippet: body.replace(/\s+/g, ' '),
      });
    } catch (e) {
      results.push({
        label: t.label,
        url: t.url,
        status: null,
        error: e instanceof Error ? e.message : String(e),
        duration_ms: Date.now() - started,
      });
    }
  }

  return c.json({
    ran_at: new Date().toISOString(),
    worker_region: c.req.header('cf-ipcountry') ?? 'unknown',
    cf_colo: c.req.raw.cf?.colo ?? 'unknown',
    results,
  });
});

// ---------- Local-ingest import endpoint ----------
// Accepts raw USAspending response pages from a local CLI (bypasses the
// Cloudflare-edge → USAspending 525 issue), normalizes + upserts them.
//
// Flow: local script POSTs each page with `finalize: false`, then sends
// one final POST with `finalize: true` (and empty response) to close out.

app.post('/import/awards', async (c) => {
  // Optional shared-secret auth. If INGEST_TOKEN is set on the Worker,
  // require a matching Bearer token. If unset (dev), allow all.
  const expected = c.env.INGEST_TOKEN;
  if (expected) {
    const auth = c.req.header('authorization') ?? '';
    const supplied = auth.replace(/^Bearer\s+/i, '').trim();
    // Constant-time compare to avoid timing side channels.
    if (!supplied || supplied.length !== expected.length) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    let eq = 0;
    for (let i = 0; i < supplied.length; i++) {
      eq |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    if (eq !== 0) return c.json({ error: 'unauthorized' }, 401);
  }

  const body = await c.req.json().catch(() => null) as {
    run_id?: number;
    response?: { results: unknown[]; page_metadata?: unknown };
    finalize?: boolean;
    metadata?: Record<string, unknown>;  // filters used, for audit
  } | null;
  if (!body) return c.json({ error: 'invalid JSON body' }, 400);

  const now = new Date().toISOString();

  // Open or reuse ingestion_run
  let runId = body.run_id;
  if (!runId) {
    const res = await c.env.DB.prepare(`
      INSERT INTO ingestion_run (source_id, started_at, status, error_summary)
      VALUES ('usaspending', ?, 'running', ?)
      RETURNING run_id
    `).bind(now, 'local-ingest').first<{ run_id: number }>();
    if (!res) return c.json({ error: 'failed to open run' }, 500);
    runId = res.run_id;
  }

  // Normalize + upsert
  const adapter = new UsaspendingAdapter();
  let upserted = 0;
  let failed = 0;
  const failures: Array<{ award: string; reason: string }> = [];
  const results = body.response?.results ?? [];
  if (results.length) {
    const canonical = adapter.parse({
      endpoint: '(local-ingest)',
      requestParams: body.metadata ?? {},
      response: body.response,
      responseHash: '',
    });
    for (const award of canonical) {
      try {
        const stmts = await buildUpsertStatements(c.env.DB, 'usaspending', award);
        await c.env.DB.batch(stmts);
        upserted++;
      } catch (e) {
        failed++;
        if (failures.length < 10) {
          failures.push({
            award: award.external_id,
            reason: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
          });
        }
      }
    }
    await c.env.DB.prepare(`
      UPDATE ingestion_run
      SET rows_fetched  = rows_fetched + ?,
          rows_upserted = rows_upserted + ?,
          rows_failed   = rows_failed + ?
      WHERE run_id = ?
    `).bind(results.length, upserted, failed, runId).run();
  }

  if (body.finalize) {
    await c.env.DB.prepare(`
      UPDATE ingestion_run
      SET status = 'success',
          finished_at = ?,
          error_summary = COALESCE(error_summary, 'local-ingest complete')
      WHERE run_id = ?
    `).bind(now, runId).run();
  }

  return c.json({ run_id: runId, fetched: results.length, upserted, failed, failures });
});

// ---------- Cancel runs ----------

const WORKFLOW_BY_SOURCE: Record<string, keyof Env> = {
  usaspending: 'USASPENDING_WORKFLOW',
  sam_bulk:    'SAM_BULK_WORKFLOW',
  grants_gov:  'GRANTS_GOV_WORKFLOW',
};

async function terminateInstance(env: Env, sourceId: string, instanceId: string | null): Promise<string | null> {
  if (!instanceId) return 'no workflow_instance_id recorded';
  const binding = WORKFLOW_BY_SOURCE[sourceId];
  if (!binding) return `no workflow binding for source '${sourceId}'`;
  try {
    const wf = env[binding] as Workflow;
    const inst = await wf.get(instanceId);
    await inst.terminate();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

app.post('/runs/:id/cancel', async (c) => {
  const runId = Number(c.req.param('id'));
  const row = await c.env.DB.prepare(`
    SELECT run_id, source_id, status, workflow_instance_id
    FROM ingestion_run WHERE run_id = ?
  `).bind(runId).first<{ run_id: number; source_id: string; status: string; workflow_instance_id: string | null }>();
  if (!row) return c.json({ error: 'run not found' }, 404);
  if (row.status !== 'running') return c.json({ error: `run is not running (status=${row.status})` }, 400);

  const warn = await terminateInstance(c.env, row.source_id, row.workflow_instance_id);
  await c.env.DB.prepare(`
    UPDATE ingestion_run
    SET status = 'failed',
        finished_at = datetime('now'),
        error_summary = ?
    WHERE run_id = ?
  `).bind(warn ? `cancelled (${warn})` : 'cancelled by user', runId).run();

  return c.json({ cancelled: true, run_id: runId, warning: warn });
});

app.post('/runs/cancel-all', async (c) => {
  const runs = await c.env.DB.prepare(`
    SELECT run_id, source_id, workflow_instance_id
    FROM ingestion_run WHERE status = 'running'
  `).all<{ run_id: number; source_id: string; workflow_instance_id: string | null }>();

  const results: Array<{ run_id: number; terminated: boolean; warning?: string }> = [];
  for (const r of runs.results) {
    const warn = await terminateInstance(c.env, r.source_id, r.workflow_instance_id);
    results.push({ run_id: r.run_id, terminated: !warn, warning: warn ?? undefined });
  }

  await c.env.DB.prepare(`
    UPDATE ingestion_run
    SET status = 'failed', finished_at = datetime('now'), error_summary = 'bulk cancel'
    WHERE status = 'running'
  `).run();

  return c.json({ count: results.length, results });
});

// ---------- Scoped pulls (dashboard Pull tab) ----------

app.post('/pull/usaspending', async (c) => {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return c.json({ error: 'invalid JSON body' }, 400);
  try {
    const instance = await c.env.USASPENDING_WORKFLOW.create({ params: body });
    return c.json({ id: instance.id, params: body });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.post('/pull/sam-bulk', async (c) => {
  const body = await c.req.json().catch(() => ({ extracts: ['exclusions'] }));
  try {
    const instance = await c.env.SAM_BULK_WORKFLOW.create({ params: body });
    return c.json({ id: instance.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.post('/pull/grants-gov', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    const instance = await c.env.GRANTS_GOV_WORKFLOW.create({ params: body });
    return c.json({ id: instance.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

// ---------- Schedule status ----------

app.get('/schedule/status', async (c) => {
  const rows = await buildScheduleStatus(c.env.DB);

  // Enrich with SAM API budget if reachable
  let samBudget: unknown = null;
  try {
    const res = await c.env.SAM_API.fetch('https://sam/status');
    samBudget = await res.json();
  } catch { /* service binding may be absent during local dev */ }

  const summary = {
    healthy: rows.filter((r) => r.health === 'healthy').length,
    running: rows.filter((r) => r.health === 'running').length,
    stale:   rows.filter((r) => r.health === 'stale').length,
    error:   rows.filter((r) => r.health === 'error').length,
    never_run: rows.filter((r) => r.health === 'never_run').length,
    disabled:  rows.filter((r) => r.health === 'disabled').length,
    as_of: new Date().toISOString(),
  };
  return c.json({ summary, schedules: rows, sam_budget: samBudget });
});

// ---------- SAM API enrichment (queue-backed + synchronous option) ----------

app.post('/vendors/:id/enrich', async (c) => {
  const id = c.req.param('id');
  const mode = c.req.query('mode') ?? 'queue';  // 'queue' | 'sync'

  const vendor = await c.env.DB.prepare(
    'SELECT vendor_id, uei, legal_name FROM vendor WHERE vendor_id = ? OR uei = ? LIMIT 1',
  ).bind(id, id).first<{ vendor_id: string; uei: string | null; legal_name: string }>();

  if (!vendor)        return c.json({ error: 'vendor not found' }, 404);
  if (!vendor.uei)    return c.json({ error: 'vendor has no UEI — cannot enrich' }, 422);

  if (mode === 'sync') {
    const res = await c.env.SAM_API.fetch(`https://sam/enrich/${vendor.uei}`, { method: 'POST' });
    const body = await res.json();
    return c.json(body, res.status as 200 | 400 | 429);
  }

  await c.env.SAM_ENRICH_QUEUE.send({
    uei: vendor.uei,
    requestedBy: c.req.header('cf-access-authenticated-user-email') ?? 'anonymous',
  });
  return c.json({ queued: true, uei: vendor.uei, vendor_id: vendor.vendor_id });
});

app.get('/sam-api/status', async (c) => {
  const res = await c.env.SAM_API.fetch('https://sam/status');
  return c.json(await res.json());
});

// ---------- SAM Exclusions ----------

app.get('/exclusions', async (c) => {
  const q = c.req.query('q');
  const activeOnly = c.req.query('active') !== 'false';
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 500);
  const filters: string[] = [];
  const params: unknown[] = [];
  if (q) { filters.push('(legal_name LIKE ? OR uei = ?)'); params.push(`%${q}%`, q); }
  if (activeOnly) { filters.push('is_active = 1'); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const result = await c.env.DB.prepare(`
    SELECT exclusion_id, uei, legal_name, classification, exclusion_type,
           excluding_agency, active_date, termination_date, is_active,
           state, country_code
    FROM sam_exclusion
    ${where}
    ORDER BY active_date DESC
    LIMIT ?
  `).bind(...params, limit).all();
  return c.json({ count: result.results.length, results: result.results });
});

app.get('/exclusions/by-uei/:uei', async (c) => {
  const uei = c.req.param('uei');
  const result = await c.env.DB.prepare(`
    SELECT * FROM sam_exclusion WHERE uei = ? ORDER BY active_date DESC
  `).bind(uei).all();
  return c.json({ count: result.results.length, results: result.results });
});

app.get('/vendors/:id/exclusion-status', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(`
    SELECT * FROM v_vendor_exclusion_status
    WHERE vendor_id = ? OR uei = ?
    LIMIT 1
  `).bind(id, id).first();
  if (!row) return c.json({ error: 'vendor not found' }, 404);
  return c.json(row);
});

// ---------- Grants.gov Opportunities ----------

app.get('/opportunities', async (c) => {
  const q = c.req.query('q');
  const agency = c.req.query('agency');
  const status = c.req.query('status') ?? 'posted';
  const activeOnly = c.req.query('active') !== 'false';
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 500);

  const filters: string[] = [];
  const params: unknown[] = [];

  if (q) {
    filters.push('(title LIKE ? OR opportunity_number LIKE ? OR description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (agency) { filters.push('agency_code LIKE ?'); params.push(`%${agency}%`); }
  if (status && status !== 'any') { filters.push('status = ?'); params.push(status); }
  if (activeOnly) { filters.push(`(close_date IS NULL OR date(close_date) >= date('now'))`); }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const result = await c.env.DB.prepare(`
    SELECT opportunity_id, opportunity_number, title, agency_code, agency_name,
           status, posted_date, close_date, est_total_funding,
           award_ceiling, award_floor, expected_awards,
           assistance_listings, opportunity_url,
           CAST(julianday(close_date) - julianday('now') AS INTEGER) AS days_to_close
    FROM grant_opportunity
    ${where}
    ORDER BY close_date ASC NULLS LAST
    LIMIT ?
  `).bind(...params, limit).all();
  return c.json({ count: result.results.length, results: result.results });
});

app.get('/opportunities/:id', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT * FROM grant_opportunity WHERE opportunity_id = ?',
  ).bind(c.req.param('id')).first();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(row);
});

app.get('/stats/opportunities-by-agency', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT agency_name AS agency,
           COUNT(*) AS num_open,
           COALESCE(SUM(est_total_funding), 0) AS total_funding
    FROM v_active_opportunities
    GROUP BY agency_name
    ORDER BY total_funding DESC
    LIMIT 30
  `).all();
  return c.json({ count: result.results.length, results: result.results });
});

// ---------- Reconciliation ----------

app.get('/reconciliation/latest', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT dimension_type, dimension_value, fiscal_year,
           warehouse_total, source_total, drift_abs, drift_pct,
           status, notes, check_date
    FROM v_reconciliation_latest
    ORDER BY
      CASE status WHEN 'drift' THEN 0 WHEN 'error' THEN 1 WHEN 'no_data' THEN 2 ELSE 3 END,
      ABS(COALESCE(drift_pct, 0)) DESC
    LIMIT 200
  `).all();
  return c.json({ count: result.results.length, results: result.results });
});

app.get('/reconciliation/history', async (c) => {
  const dim = c.req.query('dimension_value');
  if (!dim) return c.json({ error: 'dimension_value required' }, 400);
  const result = await c.env.DB.prepare(`
    SELECT check_date, fiscal_year, warehouse_total, source_total,
           drift_pct, status, notes
    FROM reconciliation_check
    WHERE dimension_value = ?
    ORDER BY check_date DESC
    LIMIT 100
  `).bind(dim).all();
  return c.json({ count: result.results.length, results: result.results });
});

app.get('/reconciliation/summary', async (c) => {
  const summary = await c.env.DB.prepare(`
    SELECT
      MAX(check_date) AS last_check,
      SUM(CASE WHEN status = 'ok'      THEN 1 ELSE 0 END) AS ok_count,
      SUM(CASE WHEN status = 'drift'   THEN 1 ELSE 0 END) AS drift_count,
      SUM(CASE WHEN status = 'error'   THEN 1 ELSE 0 END) AS error_count,
      SUM(CASE WHEN status = 'no_data' THEN 1 ELSE 0 END) AS no_data_count
    FROM v_reconciliation_latest
  `).first();
  return c.json(summary ?? {});
});

// ---------- 404 ----------
app.notFound((c) => c.json({ error: 'not found' }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

export default app;
