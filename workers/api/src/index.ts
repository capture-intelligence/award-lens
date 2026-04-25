import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { hitToDbRow, nowIso } from '@awards/core';
import { buildScheduleStatus } from './schedule.js';
import { backfillToptierCodes } from './admin/toptier-backfill.js';
import { runReconciliation } from './admin/reconciliation.js';
import { authApp, type AuthEnv } from './auth/routes.js';
import { adminUsersApp } from './auth/admin.js';
import { authMiddleware, requireApproved, type AuthVars } from './auth/session.js';

export interface Env extends AuthEnv {
  DB: D1Database;
  META: KVNamespace;
  SAM_API: Fetcher;
  /** Shared secret for ingest/admin endpoints. Required in production. */
  INGEST_TOKEN?: string;
}

const app = new Hono<{ Bindings: Env; Variables: AuthVars }>();

app.use('*', logger());
app.use('*', prettyJSON());
// CORS — allow the dashboard origin to send credentials (the session cookie).
app.use('*', cors({
  origin: (origin) => origin && /^https:\/\/([a-z0-9-]+\.)?awards-dashboard\.pages\.dev$/.test(origin)
    ? origin
    : 'https://awards-dashboard.pages.dev',
  credentials: true,
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length'],
}));
// Hydrate c.var.user from session cookie on every request.
app.use('*', authMiddleware);

// Mount auth + admin user-management subrouters.
app.route('/auth', authApp);
app.route('/admin', adminUsersApp);

// ---------- Public routes (no auth) ----------
app.get('/', (c) => c.json({
  service: 'awards-api',
  status: 'ok',
  time: new Date().toISOString(),
}));

// ---------- Approved-user gate ----------
// Read endpoints below this line require a session whose role is user/admin.
// Auth routes (/auth/*), admin user-mgmt (/admin/users*), and token-protected
// machine endpoints (/admin/reconcile, /import/*) handle their own auth and
// must NOT be gated here — they're matched by exact path before this prefix
// gate fires.
const SESSION_GATED_PREFIXES = [
  '/awards', '/vendors', '/organizations', '/runs', '/stats',
  '/exclusions', '/opportunities', '/reconciliation', '/schedule',
  '/sam-api', '/health',
];
app.use('*', async (c, next) => {
  const path = c.req.path;
  for (const prefix of SESSION_GATED_PREFIXES) {
    if (path === prefix || path.startsWith(prefix + '/')) {
      return requireApproved(c, next);
    }
  }
  await next();
});

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

// ---------- INGEST_TOKEN auth helper (for admin/import endpoints) ----------
function checkIngestToken(c: { req: { header: (k: string) => string | undefined }; env: Env }): string | null {
  const expected = c.env.INGEST_TOKEN;
  if (!expected) return null; // dev mode: no token required
  const supplied = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!supplied || supplied.length !== expected.length) return 'unauthorized';
  let eq = 0;
  for (let i = 0; i < supplied.length; i++) eq |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  return eq === 0 ? null : 'unauthorized';
}

// ---------- Admin: backfill toptier codes (called by VM cron) ----------
app.post('/admin/backfill-toptier-codes', async (c) => {
  const err = checkIngestToken(c); if (err) return c.json({ error: err }, 401);
  const result = await backfillToptierCodes(c.env.DB);
  return c.json(result);
});

// ---------- Admin: reconciliation (called by VM cron) ----------
app.post('/admin/reconcile', async (c) => {
  const err = checkIngestToken(c); if (err) return c.json({ error: err }, 401);
  const result = await runReconciliation(c.env.DB, c.env.META);
  return c.json(result);
});

// ---------- Import: Grants.gov opportunities (called by VM cron) ----------
app.post('/import/opportunities', async (c) => {
  const err = checkIngestToken(c); if (err) return c.json({ error: err }, 401);
  const body = await c.req.json().catch(() => null) as {
    run_id?: number;
    hits?: unknown[];
    details?: Record<string, unknown>;
    finalize?: boolean;
  } | null;
  if (!body) return c.json({ error: 'invalid JSON body' }, 400);

  const now = nowIso();
  let runId = body.run_id;
  if (!runId) {
    const r = await c.env.DB.prepare(`
      INSERT INTO ingestion_run (source_id, started_at, status, error_summary)
      VALUES ('grants_gov', ?, 'running', 'vm-import')
      RETURNING run_id
    `).bind(now).first<{ run_id: number }>();
    if (!r) return c.json({ error: 'failed to open run' }, 500);
    runId = r.run_id;
  }

  const hits = body.hits ?? [];
  const detailsMap = new Map(Object.entries(body.details ?? {}));
  const extractDate = now.slice(0, 10);
  let upserted = 0;

  for (let i = 0; i < hits.length; i += 100) {
    const chunk = hits.slice(i, i + 100);
    const stmts: D1PreparedStatement[] = [];
    for (const hit of chunk) {
      const detail = detailsMap.get(String((hit as { id: unknown }).id)) ?? null;
      const r = hitToDbRow(hit as Parameters<typeof hitToDbRow>[0], detail as Parameters<typeof hitToDbRow>[1], extractDate);
      stmts.push(c.env.DB.prepare(`
        INSERT INTO grant_opportunity
          (opportunity_id, opportunity_number, title, agency_code, agency_name,
           category, funding_instrument, assistance_listings, posted_date, close_date,
           archive_date, est_total_funding, award_ceiling, award_floor, expected_awards,
           eligibility_codes, description, status, opportunity_url, doc_type,
           extract_date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(opportunity_id) DO UPDATE SET
          opportunity_number  = excluded.opportunity_number,
          title               = excluded.title,
          agency_code         = COALESCE(excluded.agency_code, grant_opportunity.agency_code),
          agency_name         = COALESCE(excluded.agency_name, grant_opportunity.agency_name),
          posted_date         = COALESCE(excluded.posted_date, grant_opportunity.posted_date),
          close_date          = COALESCE(excluded.close_date, grant_opportunity.close_date),
          status              = excluded.status,
          extract_date        = excluded.extract_date,
          updated_at          = excluded.updated_at
      `).bind(
        r.opportunity_id, r.opportunity_number, r.title, r.agency_code, r.agency_name,
        r.category, r.funding_instrument, r.assistance_listings, r.posted_date, r.close_date,
        r.archive_date, r.est_total_funding, r.award_ceiling, r.award_floor, r.expected_awards,
        r.eligibility_codes, r.description, r.status, r.opportunity_url, r.doc_type,
        r.extract_date, now, now,
      ));
    }
    if (stmts.length) await c.env.DB.batch(stmts);
    upserted += chunk.length;
  }

  await c.env.DB.prepare(`
    UPDATE ingestion_run SET rows_fetched = rows_fetched + ?, rows_upserted = rows_upserted + ?
    WHERE run_id = ?
  `).bind(hits.length, upserted, runId).run();

  if (body.finalize) {
    await c.env.DB.prepare(`
      UPDATE ingestion_run SET status='success', finished_at=?, error_summary=COALESCE(error_summary,'vm-import complete')
      WHERE run_id = ?
    `).bind(now, runId).run();
  }
  return c.json({ run_id: runId, fetched: hits.length, upserted });
});

// ---------- Import: SAM exclusions (called by VM cron) ----------
app.post('/import/exclusions', async (c) => {
  const err = checkIngestToken(c); if (err) return c.json({ error: err }, 401);
  const body = await c.req.json().catch(() => null) as {
    run_id?: number;
    records?: Array<Record<string, unknown>>;
    finalize?: boolean;
  } | null;
  if (!body) return c.json({ error: 'invalid JSON body' }, 400);

  const now = nowIso();
  let runId = body.run_id;
  if (!runId) {
    const r = await c.env.DB.prepare(`
      INSERT INTO ingestion_run (source_id, started_at, status, error_summary)
      VALUES ('sam_bulk', ?, 'running', 'vm-import')
      RETURNING run_id
    `).bind(now).first<{ run_id: number }>();
    if (!r) return c.json({ error: 'failed to open run' }, 500);
    runId = r.run_id;
  }

  const records = body.records ?? [];
  let upserted = 0;
  for (let i = 0; i < records.length; i += 100) {
    const chunk = records.slice(i, i + 100);
    const stmts: D1PreparedStatement[] = [];
    for (const r of chunk) {
      const get = (k: string) => (r[k] ?? null) as string | null;
      stmts.push(c.env.DB.prepare(`
        INSERT INTO sam_exclusion
          (classification_type, exclusion_program, excluding_agency_name,
           cage_code, npi, sam_number, name, prefix, first_name, middle_name,
           last_name, suffix, address1, city, state_province, country,
           zip_code, dunsbradstreet, ueisam, exclusion_type, additional_comments,
           active_date, termination_date, record_status, cross_reference, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(sam_number) DO UPDATE SET
          name = excluded.name, ueisam = excluded.ueisam, cage_code = excluded.cage_code,
          active_date = excluded.active_date, termination_date = excluded.termination_date,
          record_status = excluded.record_status
      `).bind(
        get('classification_type'), get('exclusion_program'), get('excluding_agency_name'),
        get('cage_code'), get('npi'), get('sam_number'), get('name'), get('prefix'),
        get('first_name'), get('middle_name'), get('last_name'), get('suffix'),
        get('address1'), get('city'), get('state_province'), get('country'),
        get('zip_code'), get('dunsbradstreet'), get('ueisam'), get('exclusion_type'),
        get('additional_comments'), get('active_date'), get('termination_date'),
        get('record_status'), get('cross_reference'), now,
      ));
    }
    if (stmts.length) await c.env.DB.batch(stmts);
    upserted += chunk.length;
  }

  await c.env.DB.prepare(`
    UPDATE ingestion_run SET rows_fetched = rows_fetched + ?, rows_upserted = rows_upserted + ?
    WHERE run_id = ?
  `).bind(records.length, upserted, runId).run();

  if (body.finalize) {
    await c.env.DB.prepare(`
      UPDATE ingestion_run SET status='success', finished_at=?, error_summary=COALESCE(error_summary,'vm-import complete')
      WHERE run_id = ?
    `).bind(now, runId).run();
  }
  return c.json({ run_id: runId, fetched: records.length, upserted });
});

// ---------- Mark stuck runs as failed (manual cleanup, no workflow termination) ----------
// In Path B (no Workflows), there's no async workflow to terminate. This endpoint
// just closes orphaned ingestion_run rows so the dashboard reflects reality.

app.post('/runs/:id/cancel', async (c) => {
  const err = checkIngestToken(c); if (err) return c.json({ error: err }, 401);
  const runId = Number(c.req.param('id'));
  const row = await c.env.DB.prepare(`
    SELECT run_id, status FROM ingestion_run WHERE run_id = ?
  `).bind(runId).first<{ run_id: number; status: string }>();
  if (!row) return c.json({ error: 'run not found' }, 404);
  if (row.status !== 'running') return c.json({ error: `run is not running (status=${row.status})` }, 400);

  await c.env.DB.prepare(`
    UPDATE ingestion_run
    SET status = 'failed', finished_at = datetime('now'), error_summary = 'cancelled by user'
    WHERE run_id = ?
  `).bind(runId).run();

  return c.json({ cancelled: true, run_id: runId });
});

app.post('/runs/cancel-all', async (c) => {
  const err = checkIngestToken(c); if (err) return c.json({ error: err }, 401);
  const result = await c.env.DB.prepare(`
    UPDATE ingestion_run
    SET status = 'failed', finished_at = datetime('now'), error_summary = 'bulk cancel'
    WHERE status = 'running'
  `).run();
  return c.json({ count: result.meta.changes ?? 0 });
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

  // Path B: synchronous-only (no Queues on Free tier).
  // The sam-api-worker is itself synchronous; it returns 429 if the daily
  // budget is exhausted. Operator can retry tomorrow.
  const res = await c.env.SAM_API.fetch(`https://sam/enrich/${vendor.uei}`, { method: 'POST' });
  const body = await res.json();
  return c.json(body, res.status as 200 | 400 | 429);
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
