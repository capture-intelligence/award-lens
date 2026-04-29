import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import {
  hitToDbRow, nowIso,
  UsaspendingAdapter, buildUpsertStatements, deterministicId,
} from '@awards/core';
import { buildScheduleStatus } from './schedule.js';
import { backfillToptierCodes } from './admin/toptier-backfill.js';
import { runReconciliation } from './admin/reconciliation.js';
import { authApp, type AuthEnv } from './auth/routes.js';
import { adminUsersApp } from './auth/admin.js';
import { authMiddleware, requireApproved, type AuthVars } from './auth/session.js';
import {
  adminViewsApp, adminAccessApp, userViewsApp,
  loadAccessibleView, listAccessibleViewIds,
} from './views/routes.js';
import {
  adminRunsApp,
  listSidecarRunRequests, claimSidecarRunRequest, completeSidecarRunRequest,
} from './views/runs.js';
import { adminDiscoverOfficesApp } from './admin/discover-offices.js';
import { adminFiltersApp, adminFilterAccessApp, userFiltersApp } from './filters/routes.js';
import { resolveScope, composeAwardQuery } from './views/scope.js';

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
// Views: admin CRUD, admin access review, user-facing browse + request.
app.route('/admin/views', adminViewsApp);
app.route('/admin/access-requests', adminAccessApp);
app.route('/views', userViewsApp);
// Filter model — PR1 dual-write. Lives parallel to /views; PR2 cuts UI over
// and PR3 retires the view tables.
app.route('/admin/filters', adminFiltersApp);
app.route('/admin/filter-access-requests', adminFilterAccessApp);
app.route('/filters', userFiltersApp);
// Per-view "Run now" — admin trigger + recent-runs status (sub-app
// composes onto /admin/views/:viewId/{run,runs}).
app.route('/admin/views', adminRunsApp);
// Office discovery — POST /admin/views/:id/discover-offices
app.route('/admin/views', adminDiscoverOfficesApp);
// Sidecar polling endpoints (token-auth). MUST live OUTSIDE /admin/* —
// Hono's sub-app middleware scoping means adminUsersApp's `requireAdmin`
// captures everything under /admin/* even for routes registered directly.
app.get ('/sidecar/run-requests',                      listSidecarRunRequests);
app.post('/sidecar/run-requests/:requestId/claim',     claimSidecarRunRequest);
app.post('/sidecar/run-requests/:requestId/complete',  completeSidecarRunRequest);

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
  '/sam-api', '/health', '/views',
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

// ---------- Explore: every award row in a view, fully denormalized ----------
//
// One endpoint returns every column the Analytics page needs — award fields,
// vendor, awarding agency, codes, derived flags. Frontend handles search,
// sort, group-by, and CSV export client-side over this single payload.
//
// Required: ?view_id=<id>  (admins may pass any view; users only views they
// have 'granted' access to via view_access).
app.get('/explore', async (c) => {
  const scope = await resolveScope(c);
  if (scope.kind === 'error') return scope.response;
  if (scope.kind === 'unscoped') {
    return c.json({ error: 'view_id_or_filter_id_required' }, 400);
  }

  const limit = Math.min(Number(c.req.query('limit') ?? 5000), 10000);

  // Same column list for both scope kinds — only the FROM/JOIN/WHERE shape
  // differs depending on whether the caller passed view_id or filter_id.
  const SELECT_COLUMNS = `
    SELECT
      a.award_id,
      a.award_piid,
      a.parent_piid,
      a.award_type,
      a.description,
      a.base_value,
      a.current_value,
      a.obligated_amount,
      a.currency_code,
      a.pop_start_date,
      a.pop_end_date,
      a.solicitation_id,
      a.source_last_modified,
      a.naics_code,
      n.description AS naics_description,
      a.psc_code,
      p.description AS psc_description,
      v.uei                AS vendor_uei,
      v.legal_name         AS vendor_name,
      v.country_code       AS vendor_country,
      v.state              AS vendor_state,
      v.city               AS vendor_city,
      v.zip                AS vendor_zip,
      o.canonical_name     AS awarding_agency,
      o.short_name         AS awarding_department,
      apl.country_code     AS pop_country,
      apl.state            AS pop_state,
      apl.city             AS pop_city,
      apl.congressional_district AS pop_district,
      (SELECT GROUP_CONCAT(federal_account_code, '|')
       FROM   award_federal_account WHERE award_id = a.award_id) AS federal_account_codes,
      (SELECT GROUP_CONCAT(IFNULL(federal_account_name, ''), '|')
       FROM   award_federal_account WHERE award_id = a.award_id) AS federal_account_names,
      (SELECT GROUP_CONCAT(IFNULL(program_activity_code, ''), '|')
       FROM   award_federal_account WHERE award_id = a.award_id) AS program_activity_codes,
      (SELECT GROUP_CONCAT(IFNULL(program_activity_name, ''), '|')
       FROM   award_federal_account WHERE award_id = a.award_id) AS program_activity_names,
      CAST(julianday(a.pop_end_date) - julianday('now') AS INTEGER) AS days_to_contract_end,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM sam_exclusion e
          WHERE (e.uei = v.uei OR e.legal_name = v.legal_name)
            AND e.is_active = 1
            AND (e.termination_date IS NULL OR date(e.termination_date) >= date('now'))
        ) THEN 1 ELSE 0
      END AS is_excluded
  `;
  const COMMON_JOINS = `
    LEFT  JOIN vendor v           ON v.vendor_id     = a.vendor_id
    LEFT  JOIN organization o     ON o.org_id        = a.awarding_org_id
    LEFT  JOIN naics_code n       ON n.naics_code    = a.naics_code
    LEFT  JOIN psc_code p         ON p.psc_code      = a.psc_code
    LEFT  JOIN award_performance_location apl ON apl.award_id = a.award_id
  `;
  const ORDER_TAIL = `ORDER BY a.pop_end_date DESC NULLS LAST, a.current_value DESC LIMIT ?`;

  if (scope.kind === 'scoped') {
    // Legacy view: M2M-tagged via view_award.
    const r = await c.env.DB.prepare(`
      ${SELECT_COLUMNS}
      FROM view_award vw
      INNER JOIN award a ON a.award_id = vw.award_id
      ${COMMON_JOINS}
      WHERE vw.view_id = ?
      ${ORDER_TAIL}
    `).bind(scope.view.view_id, limit).all();
    return c.json({
      view_id:   scope.view.view_id,
      view_name: scope.view.name,
      count:     r.results.length,
      results:   r.results,
    });
  }

  // New filter path: query-time only. Subtier + federal_account expansion,
  // plus the soft filter clauses (NAICS / PSC / value range / end-date window).
  const f = scope.filter.filters;
  const where: string[] = [];
  const params: unknown[] = [];

  // Awarding-agency narrowing: subtier_agency_name is the canonical CDC label.
  let agencyJoin = '';
  if (f.subtier_agency_name) {
    agencyJoin = ` INNER JOIN organization scope_o ON scope_o.org_id = a.awarding_org_id AND scope_o.canonical_name = ?`;
    params.push(f.subtier_agency_name);
  } else if (f.toptier_agency_name) {
    agencyJoin = ` INNER JOIN organization scope_o ON scope_o.org_id = a.awarding_org_id AND scope_o.short_name = ?`;
    params.push(f.toptier_agency_name);
  }

  if (f.federal_account_codes?.length) {
    const placeholders = f.federal_account_codes.map(() => '?').join(',');
    where.push(`a.award_id IN (
      SELECT DISTINCT award_id FROM award_federal_account
      WHERE federal_account_code IN (${placeholders})
    )`);
    params.push(...f.federal_account_codes);
  }
  if (f.naics_codes?.length) {
    const ph = f.naics_codes.map(() => '?').join(',');
    where.push(`a.naics_code IN (${ph})`);
    params.push(...f.naics_codes);
  }
  if (f.psc_codes?.length) {
    const ph = f.psc_codes.map(() => '?').join(',');
    where.push(`a.psc_code IN (${ph})`);
    params.push(...f.psc_codes);
  }
  if (typeof f.min_value === 'number') {
    where.push('a.current_value >= ?');
    params.push(f.min_value);
  }
  if (typeof f.max_value === 'number') {
    where.push('a.current_value <= ?');
    params.push(f.max_value);
  }
  const hasLB = typeof f.lookback_months === 'number' && f.lookback_months > 0;
  const hasFW = typeof f.forward_months  === 'number' && f.forward_months  > 0;
  if (hasLB && hasFW) {
    where.push(`(a.pop_end_date IS NULL OR date(a.pop_end_date) BETWEEN date('now', ?) AND date('now', ?))`);
    params.push(`-${f.lookback_months} months`, `+${f.forward_months} months`);
  } else if (hasLB) {
    where.push(`(a.pop_end_date IS NULL OR date(a.pop_end_date) >= date('now', ?))`);
    params.push(`-${f.lookback_months} months`);
  } else if (hasFW) {
    where.push(`(a.pop_end_date IS NULL OR date(a.pop_end_date) <= date('now', ?))`);
    params.push(`+${f.forward_months} months`);
  }
  // pop_states (place-of-performance) — only relevant when set; joins APL.
  if (f.pop_states?.length) {
    const ph = f.pop_states.map(() => '?').join(',');
    where.push(`apl.state IN (${ph})`);
    params.push(...f.pop_states);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const r = await c.env.DB.prepare(`
    ${SELECT_COLUMNS}
    FROM award a
    ${agencyJoin}
    ${COMMON_JOINS}
    ${whereSql}
    ${ORDER_TAIL}
  `).bind(...params, limit).all();

  return c.json({
    filter_id:   scope.filter.filter_id,
    view_id:     scope.filter.filter_id,    // legacy alias for the dashboard until PR2
    view_name:   scope.filter.name,
    count:       r.results.length,
    results:     r.results,
  });
});

app.get('/awards', async (c) => {
  const scope = await resolveScope(c);
  if (scope.kind === 'error') return scope.response;

  const q = c.req.query('q');
  const org = c.req.query('awarding_org');
  const vendor = c.req.query('vendor');
  const minValue = Number(c.req.query('min_value') ?? 0);
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 500);

  const userClauses: string[] = [];
  const userParams: unknown[] = [];
  if (q) {
    userClauses.push('(va.description LIKE ? OR va.award_piid LIKE ?)');
    userParams.push(`%${q}%`, `%${q}%`);
  }
  if (org) {
    userClauses.push('va.awarding_org_name LIKE ?');
    userParams.push(`%${org}%`);
  }
  if (vendor) {
    userClauses.push('va.vendor_name LIKE ?');
    userParams.push(`%${vendor}%`);
  }
  if (minValue > 0) {
    userClauses.push('va.current_value >= ?');
    userParams.push(minValue);
  }

  const { sql, params } = composeAwardQuery({
    scope,
    selectClause: 'SELECT va.* FROM v_award_current va',
    extraWhere: userClauses.length ? userClauses.join(' AND ') : undefined,
    extraParams: userParams,
    // Default sort: latest contract end first. Awards with no end date sink
    // to the bottom (procurement teams care about what's ending soonest in
    // the future, then most-recently-ended).
    tail: 'ORDER BY va.pop_end_date DESC NULLS LAST, va.current_value DESC LIMIT ?',
    tailParams: [limit],
  });

  const result = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ count: result.results.length, results: result.results });
});

app.get('/awards/:id', async (c) => {
  const scope = await resolveScope(c);
  if (scope.kind === 'error') return scope.response;

  // Single-award lookup must also honor scope so users can't peek across views.
  const { sql, params } = composeAwardQuery({
    scope,
    selectClause: 'SELECT va.* FROM v_award_current va',
    extraWhere: 'va.award_id = ?',
    extraParams: [c.req.param('id')],
    tail: 'LIMIT 1',
  });
  const row = await c.env.DB.prepare(sql).bind(...params).first();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(row);
});

app.get('/awards/expiring/:months', async (c) => {
  const scope = await resolveScope(c);
  if (scope.kind === 'error') return scope.response;

  const months = Math.min(Number(c.req.param('months') ?? 18), 60);

  const { sql, params } = composeAwardQuery({
    scope,
    selectClause: 'SELECT va.* FROM v_award_current va',
    extraWhere: `va.pop_end_date IS NOT NULL
                 AND date(va.pop_end_date) BETWEEN date('now') AND date('now', ?)`,
    extraParams: [`+${months} months`],
    tail: 'ORDER BY va.current_value DESC LIMIT 500',
  });
  const result = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ count: result.results.length, months, results: result.results });
});

// ---------- Vendors ----------

app.get('/vendors', async (c) => {
  const scope = await resolveScope(c);
  if (scope.kind === 'error') return scope.response;

  const q = c.req.query('q');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 500);

  if (scope.kind === 'unscoped') {
    let sql = 'SELECT * FROM v_vendor_rollup';
    const params: unknown[] = [];
    if (q) { sql += ' WHERE legal_name LIKE ?'; params.push(`%${q}%`); }
    sql += ' ORDER BY total_value DESC LIMIT ?';
    params.push(limit);
    const r = await c.env.DB.prepare(sql).bind(...params).all();
    return c.json({ count: r.results.length, results: r.results });
  }

  // Scoped: aggregate vendor rollup over only this view's awards.
  const { sql, params } = composeAwardQuery({
    scope,
    selectClause: `
      SELECT
        v.vendor_id, v.uei, v.legal_name,
        COUNT(va.award_id)                     AS num_awards,
        COALESCE(SUM(va.current_value), 0)     AS total_value,
        MIN(va.pop_start_date)                 AS first_award_date,
        MAX(va.pop_end_date)                   AS last_pop_end
      FROM v_award_current va
      JOIN vendor v ON v.vendor_id = va.vendor_id
    `,
    extraWhere: q ? 'v.legal_name LIKE ?' : undefined,
    extraParams: q ? [`%${q}%`] : [],
    tail: `GROUP BY v.vendor_id, v.uei, v.legal_name
           ORDER BY total_value DESC
           LIMIT ?`,
    tailParams: [limit],
  });
  const r = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ count: r.results.length, results: r.results });
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
  const scope = await resolveScope(c);
  if (scope.kind === 'error') return scope.response;

  if (scope.kind === 'unscoped') {
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
  }

  // Scoped: count + sum within the view's award set.
  const { sql, params } = composeAwardQuery({
    scope,
    selectClause: `
      SELECT
        COUNT(DISTINCT va.award_id)            AS awards,
        COUNT(DISTINCT va.vendor_id)           AS vendors,
        COUNT(DISTINCT va.awarding_org_name)   AS organizations,
        COALESCE(SUM(va.current_value), 0)     AS total_obligated_usd
      FROM v_award_current va
    `,
    tail: '',
  });
  const r = await c.env.DB.prepare(sql).bind(...params).first<{
    awards: number; vendors: number; organizations: number; total_obligated_usd: number;
  }>();
  return c.json({
    awards: r?.awards ?? 0,
    vendors: r?.vendors ?? 0,
    organizations: r?.organizations ?? 0,
    total_obligated_usd: r?.total_obligated_usd ?? 0,
  });
});

app.get('/stats/top-vendors', async (c) => {
  const scope = await resolveScope(c);
  if (scope.kind === 'error') return scope.response;

  const limit = Math.min(Number(c.req.query('limit') ?? 10), 100);

  if (scope.kind === 'unscoped') {
    const r = await c.env.DB.prepare(`
      SELECT * FROM v_vendor_rollup
      WHERE num_awards > 0
      ORDER BY total_value DESC
      LIMIT ?
    `).bind(limit).all();
    return c.json({ count: r.results.length, results: r.results });
  }

  const { sql, params } = composeAwardQuery({
    scope,
    selectClause: `
      SELECT
        v.vendor_id, v.uei, v.legal_name,
        COUNT(va.award_id)                 AS num_awards,
        COALESCE(SUM(va.current_value), 0) AS total_value
      FROM v_award_current va
      JOIN vendor v ON v.vendor_id = va.vendor_id
    `,
    tail: `GROUP BY v.vendor_id, v.uei, v.legal_name
           ORDER BY total_value DESC
           LIMIT ?`,
    tailParams: [limit],
  });
  const r = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ count: r.results.length, results: r.results });
});

app.get('/stats/by-agency', async (c) => {
  const scope = await resolveScope(c);
  if (scope.kind === 'error') return scope.response;

  if (scope.kind === 'unscoped') {
    const r = await c.env.DB.prepare(`
      SELECT o.canonical_name AS agency,
             COUNT(a.award_id) AS num_awards,
             COALESCE(SUM(a.current_value), 0) AS total_value
      FROM award a
      JOIN organization o ON o.org_id = a.awarding_org_id
      GROUP BY o.canonical_name
      ORDER BY total_value DESC
      LIMIT 50
    `).all();
    return c.json({ count: r.results.length, results: r.results });
  }

  const { sql, params } = composeAwardQuery({
    scope,
    selectClause: `
      SELECT va.awarding_org_name AS agency,
             COUNT(va.award_id)   AS num_awards,
             COALESCE(SUM(va.current_value), 0) AS total_value
      FROM v_award_current va
    `,
    tail: 'GROUP BY va.awarding_org_name ORDER BY total_value DESC LIMIT 50',
  });
  const r = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ count: r.results.length, results: r.results });
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
      init: { redirect: 'manual' },
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

// ---------- Internal: backfill toptier codes (called by VM cron) ----------
// Token-auth. Lives at /internal/* (not /admin/*) — adminUsersApp's
// wildcard `requireAdmin` middleware would otherwise reject the caller.
app.post('/internal/backfill-toptier-codes', async (c) => {
  const err = checkIngestToken(c); if (err) return c.json({ error: err }, 401);
  const result = await backfillToptierCodes(c.env.DB);
  return c.json(result);
});

// ---------- Internal: reconciliation (called by VM cron) ----------
app.post('/internal/reconcile', async (c) => {
  const err = checkIngestToken(c); if (err) return c.json({ error: err }, 401);
  const result = await runReconciliation(c.env.DB, c.env.META);
  return c.json(result);
});

// ---------- Sidecar: read enabled views with their filters ----------
//
// Token-auth (NOT session). Returns one row per enabled view; the sidecar
// loops over these and runs a USAspending pull per view, posting back to
// /import/awards with view_id set. That's how each view "fills its bucket."
//
// Lives at /sidecar/* (not /admin/*) — adminUsersApp's wildcard
// `requireAdmin` middleware would otherwise reject the token-auth caller.
app.get('/sidecar/views', async (c) => {
  const err = checkIngestToken(c); if (err) return c.json({ error: err }, 401);
  const r = await c.env.DB.prepare(`
    SELECT view_id, name, description, filters_json
    FROM data_view
    WHERE enabled = 1
    ORDER BY name ASC
  `).all<{ view_id: string; name: string; description: string | null; filters_json: string }>();
  return c.json({
    count: r.results.length,
    results: r.results.map((row) => ({
      view_id: row.view_id,
      name: row.name,
      description: row.description,
      filters: JSON.parse(row.filters_json),
    })),
  });
});

// ---------- Sidecar: which awards are fully enriched? ----------
//
// "Fully enriched" = has at least one row in award_federal_account AND a
// non-null awarding_office_id. Both are populated atomically per page by
// the sidecar's enrichWithDetail loop, so requiring BOTH catches awards that
// were enriched before federal-account capture was added (those would have
// office but no funding rows — they need a re-enrich).
//
// Body: { external_ids: [generated_internal_id, ...] }.
// Response: { external_ids: [<subset already fully enriched>] }.
app.post('/sidecar/awards/with-office', async (c) => {
  const err = checkIngestToken(c); if (err) return c.json({ error: err }, 401);
  const body = await c.req.json().catch(() => null) as { external_ids?: string[] } | null;
  const ids = (body?.external_ids ?? []).filter((s) => typeof s === 'string' && s.length > 0);
  if (ids.length === 0) return c.json({ external_ids: [] });

  const seen: string[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    const placeholders = slice.map(() => '?').join(',');
    const r = await c.env.DB.prepare(`
      SELECT m.external_id
      FROM external_id_mapping m
      JOIN award a ON a.award_id = m.internal_id
      WHERE m.source_id = 'usaspending'
        AND m.entity_type = 'award'
        AND a.awarding_office_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM award_federal_account WHERE award_id = a.award_id)
        AND m.external_id IN (${placeholders})
    `).bind(...slice).all<{ external_id: string }>();
    for (const row of r.results) seen.push(row.external_id);
  }
  return c.json({ external_ids: seen });
});

// ---------- Import: USAspending awards (called by VM sidecar, per view) ----------
//
// Body: { run_id?, view_id, response, finalize, metadata }
//   run_id      — omit on first page; the worker creates one and returns it
//   view_id     — required: every award gets tagged into view_award for this view
//   response    — the parsed USAspending /search/spending_by_award/ JSON page
//   finalize    — true on the last call (no response needed); marks run as success
//   metadata    — free-form, stored in error_summary as JSON
app.post('/import/awards', async (c) => {
  const err = checkIngestToken(c); if (err) return c.json({ error: err }, 401);
  const body = await c.req.json().catch(() => null) as {
    run_id?: number;
    view_id?: string;
    response?: unknown;
    finalize?: boolean;
    metadata?: Record<string, unknown>;
  } | null;
  if (!body) return c.json({ error: 'invalid JSON body' }, 400);
  if (!body.view_id) return c.json({ error: 'view_id is required' }, 400);

  // Validate the view exists and is enabled — protects against stale clients.
  const view = await c.env.DB.prepare(
    'SELECT view_id FROM data_view WHERE view_id = ? AND enabled = 1',
  ).bind(body.view_id).first<{ view_id: string }>();
  if (!view) return c.json({ error: 'view_not_found_or_disabled' }, 404);

  const now = nowIso();
  let runId = body.run_id;
  if (!runId) {
    const r = await c.env.DB.prepare(`
      INSERT INTO ingestion_run (source_id, started_at, status, error_summary)
      VALUES ('usaspending', ?, 'running', ?)
      RETURNING run_id
    `).bind(
      now,
      JSON.stringify({ view_id: body.view_id, ...(body.metadata ?? {}) }),
    ).first<{ run_id: number }>();
    if (!r) return c.json({ error: 'failed to open run' }, 500);
    runId = r.run_id;
  }

  // Finalize-only call (sidecar end-of-loop signal).
  // Same trust-but-verify purges as on the main path — agency strict + end-date
  // window. Without these, finalizing without a body would skip purges entirely.
  if (!body.response) {
    if (body.finalize) {
      // Two trust-but-verify purges on every finalize:
      //   1. Agency strict — drop cross-agency noise (NIH / FDA / ASPR / etc.)
      //   2. Contract-end window — sliding [today − lookback, today + forward],
      //      computed from each view's lookback_months / forward_months. With
      //      lookback=18 / forward=6 (the operator standard) that's a 24-month
      //      window that slides on every pull.
      const a  = await purgeAgencyMismatches(c.env.DB, body.view_id);
      const w  = await purgeOutOfDateWindow(c.env.DB, body.view_id);
      const o  = await purgeOfficeMismatches(c.env.DB, body.view_id);
      const fa = await purgeFederalAccountMismatches(c.env.DB, body.view_id);
      const summary = `agency: ${a} | window: ${w} | office: ${o} | federal_account: ${fa}`;
      await c.env.DB.prepare(`
        UPDATE ingestion_run
        SET status = 'success', finished_at = ?,
            error_summary = COALESCE(error_summary || ' | ', '') || ?
        WHERE run_id = ?
      `).bind(now, summary, runId).run();
      return c.json({
        run_id: runId, upserted: 0, failed: 0,
        agency_purged: a, window_purged: w, office_purged: o, federal_account_purged: fa,
      });
    }
    return c.json({ run_id: runId, upserted: 0, failed: 0 });
  }

  // Parse the page to canonical awards.
  const adapter = new UsaspendingAdapter();
  const canonical = adapter.parse({
    endpoint: '/search/spending_by_award/',
    requestParams: {},
    response: body.response,
    responseHash: '',
  });

  // Upsert each award (in its own batch so a single bad row doesn't kill the page).
  let upserted = 0;
  let failed = 0;
  const awardIds: string[] = [];
  let firstError: string | null = null;
  for (const award of canonical) {
    try {
      const stmts = await buildUpsertStatements(c.env.DB, 'usaspending', award);
      await c.env.DB.batch(stmts);
      const awardId = await deterministicId('usaspending', `award::${award.external_id}`);
      awardIds.push(awardId);
      upserted++;
    } catch (err) {
      failed++;
      if (failed <= 5) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[upsert-fail]', JSON.stringify({
          external_id: award.external_id,
          piid: award.award_piid,
          has_office: !!award.awarding_office,
          has_funding: Array.isArray(award.funding_accounts) ? award.funding_accounts.length : null,
          err: msg.slice(0, 400),
        }));
        if (!firstError) firstError = msg.slice(0, 200);
      }
    }
  }
  if (firstError) console.error('[upsert-summary]', `${failed}/${canonical.length} failed; first error: ${firstError}`);

  // Bucket the awards under this view.
  if (awardIds.length > 0) {
    const tagStmts = awardIds.map((awardId) =>
      c.env.DB.prepare(`
        INSERT OR IGNORE INTO view_award (view_id, award_id, added_at)
        VALUES (?, ?, ?)
      `).bind(body.view_id, awardId, now),
    );
    await c.env.DB.batch(tagStmts);
  }

  // Update run counters.
  await c.env.DB.prepare(`
    UPDATE ingestion_run
    SET rows_fetched  = rows_fetched  + ?,
        rows_upserted = rows_upserted + ?,
        rows_failed   = rows_failed   + ?
    WHERE run_id = ?
  `).bind(canonical.length, upserted, failed, runId).run();

  // ── Trust-but-verify purges (run only on finalize) ────────────────────
  //
  // USAspending's keyword filter and time_period filter are both loose —
  // a search for "surveillance" returns matches from across the whole
  // agency hierarchy, and time_period only accepts action_date / etc.
  // (not contract end date). So after the upsert we run two cleanups:
  //
  //   1. Agency-strict: drop tags whose canonical awarding_org doesn't
  //      satisfy the view's toptier_agency_name + subtier_agency_name.
  //
  //   2. Contract-end-date window: drop tags whose award.pop_end_date
  //      falls outside [today − lookback_months, today + forward_months].
  //      This is the actual filter the user asked for — the API doesn't
  //      let us enforce it at the request layer.
  //
  // Award rows are preserved (they may belong to other views legitimately);
  // we only remove the (view_id, award_id) entries from view_award.
  let agencyPurged = 0;
  let windowPurged = 0;
  let officePurged = 0;
  let federalAccountPurged = 0;
  if (body.finalize) {
    agencyPurged         = await purgeAgencyMismatches(c.env.DB, body.view_id);
    windowPurged         = await purgeOutOfDateWindow(c.env.DB, body.view_id);
    officePurged         = await purgeOfficeMismatches(c.env.DB, body.view_id);
    federalAccountPurged = await purgeFederalAccountMismatches(c.env.DB, body.view_id);
  }

  if (body.finalize) {
    const summary = `agency: ${agencyPurged} | window: ${windowPurged} | office: ${officePurged} | federal_account: ${federalAccountPurged}`;
    await c.env.DB.prepare(`
      UPDATE ingestion_run
      SET status = 'success', finished_at = ?,
          error_summary = COALESCE(error_summary || ' | ', '') || ?
      WHERE run_id = ?
    `).bind(now, summary, runId).run();
  }

  return c.json({
    run_id: runId, upserted, failed,
    agency_purged: agencyPurged,
    window_purged: windowPurged,
    office_purged: officePurged,
    federal_account_purged: federalAccountPurged,
  });
});

/**
 * Untag awards from a view whose canonical awarding_org doesn't satisfy the
 * view's `toptier_agency_name` and/or `subtier_agency_name` filters.
 *
 * The award row itself is preserved — it may belong to other views legitimately;
 * we only remove the (view_id, award_id) entry from view_award.
 *
 * Returns the number of mismatched tags that were removed.
 */
async function purgeAgencyMismatches(db: D1Database, viewId: string): Promise<number> {
  const v = await db.prepare(
    'SELECT filters_json FROM data_view WHERE view_id = ?',
  ).bind(viewId).first<{ filters_json: string }>();
  if (!v) return 0;

  let f: { toptier_agency_name?: string; subtier_agency_name?: string };
  try { f = JSON.parse(v.filters_json); } catch { return 0; }
  const top = f.toptier_agency_name?.trim();
  const sub = f.subtier_agency_name?.trim();
  if (!top && !sub) return 0; // no agency filter set — nothing to enforce

  // Sub-tier wins on canonical_name. Toptier matches on short_name (which the
  // USAspending adapter sets to the toptier label) when subtier is also set,
  // or on canonical_name when the award was tagged at toptier-only level.
  // Awards with no awarding_org row at all are also dropped — we can't verify.
  const result = await db.prepare(`
    DELETE FROM view_award
    WHERE view_id = ?
      AND award_id IN (
        SELECT vw.award_id
        FROM view_award vw
        LEFT JOIN award a       ON a.award_id = vw.award_id
        LEFT JOIN organization o ON o.org_id   = a.awarding_org_id
        WHERE vw.view_id = ?
          AND (
            o.org_id IS NULL
            OR (? IS NOT NULL AND ? != '' AND IFNULL(o.canonical_name, '') != ?)
            OR (? IS NOT NULL AND ? != '' AND IFNULL(o.short_name,     '') != ?
                AND IFNULL(o.canonical_name, '')                          != ?)
          )
      )
  `).bind(
    viewId, viewId,
    sub ?? null, sub ?? '', sub ?? '',
    top ?? null, top ?? '', top ?? '', top ?? '',
  ).run();

  return result.meta?.changes ?? 0;
}

/**
 * Untag awards from a view whose contract end date (`award.pop_end_date`)
 * falls outside the view's [today − lookback_months, today + forward_months]
 * window.
 *
 * Why this lives in the worker rather than at the API layer: USAspending's
 * /search/spending_by_award/ endpoint only accepts {action_date,
 * last_modified_date, date_signed, new_awards_only} for time_period — there
 * is no way to filter on contract end date at request time. So the sidecar
 * pulls a wider net using action_date and we prune here.
 *
 * Awards with NULL pop_end_date pass through unchanged (open-ended IDVs /
 * data gaps).
 *
 * Returns the number of tags removed.
 */
async function purgeOutOfDateWindow(db: D1Database, viewId: string): Promise<number> {
  const v = await db.prepare(
    'SELECT filters_json FROM data_view WHERE view_id = ?',
  ).bind(viewId).first<{ filters_json: string }>();
  if (!v) return 0;

  let f: { lookback_months?: number; forward_months?: number };
  try { f = JSON.parse(v.filters_json); } catch { return 0; }
  const lookback = typeof f.lookback_months === 'number' && f.lookback_months > 0
    ? f.lookback_months
    : null;
  const forward = typeof f.forward_months === 'number' && f.forward_months > 0
    ? f.forward_months
    : null;
  if (lookback == null && forward == null) return 0;

  const result = await db.prepare(`
    DELETE FROM view_award
    WHERE view_id = ?
      AND award_id IN (
        SELECT vw.award_id
        FROM view_award vw
        JOIN award a ON a.award_id = vw.award_id
        WHERE vw.view_id = ?
          AND a.pop_end_date IS NOT NULL
          AND (
            (? IS NOT NULL AND date(a.pop_end_date) < date('now', ?))
            OR
            (? IS NOT NULL AND date(a.pop_end_date) > date('now', ?))
          )
      )
  `).bind(
    viewId, viewId,
    lookback,  lookback != null ? `-${lookback} months` : null,
    forward,   forward  != null ? `+${forward} months`  : null,
  ).run();

  return result.meta?.changes ?? 0;
}

/**
 * Untag awards from a view whose awarding office doesn't match any of the
 * view's `office_names`. No-op when office_names is empty (back-compat with
 * keyword-only views).
 *
 * Match is case-insensitive on contracting_office.name. We also accept the
 * fpds_office_code as a match target — convenient when an admin pastes
 * codes interchangeably with names.
 */
async function purgeOfficeMismatches(db: D1Database, viewId: string): Promise<number> {
  const v = await db.prepare(
    'SELECT filters_json FROM data_view WHERE view_id = ?',
  ).bind(viewId).first<{ filters_json: string }>();
  if (!v) return 0;

  let f: { office_names?: string[] };
  try { f = JSON.parse(v.filters_json); } catch { return 0; }
  const names = (f.office_names ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (names.length === 0) return 0;

  const lowerNames = names.map((s) => s.toLowerCase());
  const placeholders = lowerNames.map(() => '?').join(',');

  // Drop tags whose award has NO awarding_office_id, OR whose office's
  // (lowercase) name / fpds_office_code is not in the allowed set.
  const result = await db.prepare(`
    DELETE FROM view_award
    WHERE view_id = ?
      AND award_id IN (
        SELECT vw.award_id
        FROM view_award vw
        LEFT JOIN award a ON a.award_id = vw.award_id
        LEFT JOIN contracting_office co ON co.office_id = a.awarding_office_id
        WHERE vw.view_id = ?
          AND (
            co.office_id IS NULL
            OR (
              LOWER(IFNULL(co.name, '')) NOT IN (${placeholders})
              AND LOWER(IFNULL(co.fpds_office_code, '')) NOT IN (${placeholders})
            )
          )
      )
  `).bind(viewId, viewId, ...lowerNames, ...lowerNames).run();

  return result.meta?.changes ?? 0;
}

/**
 * Untag awards from a view whose funding doesn't draw from any of the view's
 * federal_account_codes. No-op when the filter is empty.
 *
 * Match: an award passes if it has at least one row in award_federal_account
 * whose federal_account_code is in the allowlist. Awards with no funding rows
 * yet (not enriched) are dropped — admins should run an ingest cycle before
 * locking federal_account_codes.
 *
 * Why this is the right precision filter for CDC: awarding office is shared
 * across all CDC centers ("CDC OFFICE OF ACQUISITION SERVICES"), but federal
 * account is appropriations-level and discriminates centers exactly:
 *   075-0950  HIV/AIDS, Viral Hepatitis, STD and TB Prevention   (NCHHSTP)
 *   075-0948  Chronic Disease Prevention and Health Promotion    (NCCDPHP)
 *   075-0947  Environmental Health                                (NCEH)
 *   075-0949  Emerging and Zoonotic Infectious Diseases           (NCEZID)
 *   075-0959  Public Health Scientific Services                   (NCHS / CSELS)
 *   075-0943  CDC-Wide Activities and Program Support             (cross-cutting)
 */
async function purgeFederalAccountMismatches(db: D1Database, viewId: string): Promise<number> {
  const v = await db.prepare(
    'SELECT filters_json FROM data_view WHERE view_id = ?',
  ).bind(viewId).first<{ filters_json: string }>();
  if (!v) return 0;

  let f: { federal_account_codes?: string[] };
  try { f = JSON.parse(v.filters_json); } catch { return 0; }
  const codes = (f.federal_account_codes ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (codes.length === 0) return 0;

  const placeholders = codes.map(() => '?').join(',');
  const result = await db.prepare(`
    DELETE FROM view_award
    WHERE view_id = ?
      AND award_id NOT IN (
        SELECT DISTINCT afa.award_id
        FROM award_federal_account afa
        WHERE afa.federal_account_code IN (${placeholders})
      )
  `).bind(viewId, ...codes).run();

  return result.meta?.changes ?? 0;
}

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
//
// Body:
//   {
//     run_id?:        existing run id (omit on first batch — server creates one)
//     extract_date:   ISO date the upstream extract was generated (required)
//     records:        Array<{ sam_number?, uei?, duns?, cage_code?, legal_name,
//                             classification?, exclusion_type?, ct_code?,
//                             active_date?, termination_date?, excluding_agency?,
//                             reason?, country_code?, state?, city?, address_line?,
//                             zip?, is_active? }>
//     finalize:       boolean — last batch closes the run
//   }
//
// `exclusion_id` is derived as a stable hash of (sam_number || uei+name+active_date)
// so re-pulls dedupe naturally via ON CONFLICT.
app.post('/import/exclusions', async (c) => {
  const err = checkIngestToken(c); if (err) return c.json({ error: err }, 401);
  const body = await c.req.json().catch(() => null) as {
    run_id?: number;
    extract_date?: string;
    records?: Array<Record<string, unknown>>;
    finalize?: boolean;
  } | null;
  if (!body) return c.json({ error: 'invalid JSON body' }, 400);

  const now = nowIso();
  const extractDate = body.extract_date ?? now.slice(0, 10);

  let runId = body.run_id;
  if (!runId) {
    const r = await c.env.DB.prepare(`
      INSERT INTO ingestion_run (source_id, started_at, status, error_summary)
      VALUES ('sam_bulk', ?, 'running', 'vm-import sam-exclusions')
      RETURNING run_id
    `).bind(now).first<{ run_id: number }>();
    if (!r) return c.json({ error: 'failed to open run' }, 500);
    runId = r.run_id;
  }

  const records = body.records ?? [];
  let upserted = 0;
  let skipped  = 0;
  for (let i = 0; i < records.length; i += 100) {
    const chunk = records.slice(i, i + 100);
    const stmts: D1PreparedStatement[] = [];
    for (const r of chunk) {
      const str = (k: string): string | null => {
        const v = r[k];
        if (v === undefined || v === null) return null;
        const s = String(v).trim();
        return s.length === 0 ? null : s;
      };
      const num = (k: string): number | null => {
        const v = r[k];
        if (v === undefined || v === null || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };

      const legalName = str('legal_name');
      if (!legalName) { skipped++; continue; }

      // Stable id: prefer SAM's row id; else hash of identity-defining fields.
      const explicitId = str('sam_number') ?? str('source_row_id');
      const fallbackKey =
        (str('uei') ?? '') + '|' +
        legalName + '|' +
        (str('active_date') ?? '') + '|' +
        (str('ct_code') ?? '');
      const exclusionId = explicitId
        ? `sam:${explicitId}`
        : `sam:hash:${await sha256Hex(fallbackKey)}`;

      const isActiveRaw = num('is_active');
      const isActive = isActiveRaw === null ? 1 : (isActiveRaw ? 1 : 0);

      stmts.push(c.env.DB.prepare(`
        INSERT INTO sam_exclusion
          (exclusion_id, source_row_id, uei, duns, cage_code, legal_name,
           classification, exclusion_type, ct_code, is_active,
           active_date, termination_date, excluding_agency, reason,
           country_code, state, city, address_line, zip,
           extract_date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(exclusion_id) DO UPDATE SET
          source_row_id    = excluded.source_row_id,
          uei              = COALESCE(excluded.uei,        sam_exclusion.uei),
          duns             = COALESCE(excluded.duns,       sam_exclusion.duns),
          cage_code        = COALESCE(excluded.cage_code,  sam_exclusion.cage_code),
          legal_name       = excluded.legal_name,
          classification   = COALESCE(excluded.classification,   sam_exclusion.classification),
          exclusion_type   = COALESCE(excluded.exclusion_type,   sam_exclusion.exclusion_type),
          ct_code          = COALESCE(excluded.ct_code,          sam_exclusion.ct_code),
          is_active        = excluded.is_active,
          active_date      = COALESCE(excluded.active_date,      sam_exclusion.active_date),
          termination_date = excluded.termination_date,
          excluding_agency = COALESCE(excluded.excluding_agency, sam_exclusion.excluding_agency),
          reason           = COALESCE(excluded.reason,           sam_exclusion.reason),
          country_code     = COALESCE(excluded.country_code,     sam_exclusion.country_code),
          state            = COALESCE(excluded.state,            sam_exclusion.state),
          city             = COALESCE(excluded.city,             sam_exclusion.city),
          address_line     = COALESCE(excluded.address_line,     sam_exclusion.address_line),
          zip              = COALESCE(excluded.zip,              sam_exclusion.zip),
          extract_date     = excluded.extract_date,
          updated_at       = excluded.updated_at
      `).bind(
        exclusionId, str('source_row_id') ?? str('sam_number'),
        str('uei'), str('duns'), str('cage_code'), legalName,
        str('classification'), str('exclusion_type'), str('ct_code'),
        isActive,
        str('active_date'), str('termination_date'),
        str('excluding_agency'), str('reason'),
        str('country_code'), str('state'), str('city'), str('address_line'), str('zip'),
        extractDate, now, now,
      ));
    }
    if (stmts.length) await c.env.DB.batch(stmts);
    upserted += stmts.length;
  }

  await c.env.DB.prepare(`
    UPDATE ingestion_run
    SET rows_fetched = rows_fetched + ?, rows_upserted = rows_upserted + ?, rows_failed = rows_failed + ?
    WHERE run_id = ?
  `).bind(records.length, upserted, skipped, runId).run();

  if (body.finalize) {
    await c.env.DB.prepare(`
      UPDATE ingestion_run
      SET status='success', finished_at=?, error_summary=COALESCE(error_summary,'vm-import sam-exclusions complete')
      WHERE run_id = ?
    `).bind(now, runId).run();
  }
  return c.json({ run_id: runId, fetched: records.length, upserted, skipped });
});

// Tiny helper used by exclusion id derivation when SAM doesn't supply one.
async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

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
  const scope = await resolveScope(c);
  if (scope.kind === 'error') return scope.response;

  const q = c.req.query('q');
  const activeOnly = c.req.query('active') !== 'false';
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 500);

  const filters: string[] = [];
  const params: unknown[] = [];
  if (q) { filters.push('(legal_name LIKE ? OR uei = ?)'); params.push(`%${q}%`, q); }
  if (activeOnly) { filters.push('is_active = 1'); }

  // View scope: limit to UEIs of vendors that have awards in this view.
  // (SAM exclusions don't carry an org/award FK themselves — we join through
  // the vendor table to find UEIs that intersect with the view's awards.)
  if (scope.kind === 'scoped') {
    filters.push(`uei IN (
      SELECT DISTINCT v.uei FROM vendor v
      JOIN award a       ON a.vendor_id = v.vendor_id
      JOIN view_award vw ON vw.award_id = a.award_id
      WHERE vw.view_id = ? AND v.uei IS NOT NULL
    )`);
    params.push(scope.view.view_id);
  }

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
  const scope = await resolveScope(c);
  if (scope.kind === 'error') return scope.response;

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

  // View scope: match by agency name. If the view picks a subtier (CDC, NIH),
  // prefer that — it's narrower. Otherwise fall back to the toptier (HHS).
  // Match against agency_name OR agency_code, since Grants.gov data uses
  // both — agency_code is "HHS-CDC", agency_name is the full string.
  if (scope.kind === 'scoped') {
    const f = scope.view.filters;
    const targetName = f.subtier_agency_name ?? f.toptier_agency_name;
    if (targetName) {
      filters.push('(agency_name LIKE ? OR agency_code LIKE ?)');
      params.push(`%${targetName}%`, `%${targetName}%`);
    }
  }

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
