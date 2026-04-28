/**
 * Views API:
 *   - Admin CRUD on data_view
 *   - Admin review of access requests
 *   - Approved-user request flow
 *   - Helpers (loadView, requireViewAccess) consumed by data endpoints.
 */

import { Hono, type Context } from 'hono';
import { nowIso, requireAdmin, requireApproved, type AuthVars } from '../auth/session.js';
import { parseFilters, deserializeFilters, serializeFilters, type ViewFilters } from './filters.js';

export interface ViewsEnv {
  DB: D1Database;
}

type Ctx = { Bindings: ViewsEnv; Variables: AuthVars };

interface DataViewRow {
  view_id: string;
  name: string;
  description: string | null;
  enabled: number;
  filters_json: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface AccessRow {
  access_id: string;
  view_id: string;
  user_id: string;
  status: 'requested' | 'granted' | 'denied' | 'revoked';
  requested_at: string;
  requested_note: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
}

function newId(): string {
  return crypto.randomUUID();
}

function shapeView(row: DataViewRow) {
  return {
    view_id: row.view_id,
    name: row.name,
    description: row.description,
    enabled: !!row.enabled,
    filters: deserializeFilters(row.filters_json),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// =================================================================
// Admin routes — /admin/views/*
// =================================================================

export const adminViewsApp = new Hono<Ctx>();
adminViewsApp.use('*', requireAdmin);

// List all views (admin sees everything, including disabled)
adminViewsApp.get('/', async (c) => {
  const r = await c.env.DB.prepare(`
    SELECT * FROM data_view ORDER BY created_at DESC
  `).all<DataViewRow>();
  return c.json({ count: r.results.length, results: r.results.map(shapeView) });
});

// Single view + per-view counts
adminViewsApp.get('/:id', async (c) => {
  const id = c.req.param('id');
  const v = await c.env.DB.prepare('SELECT * FROM data_view WHERE view_id = ?')
    .bind(id).first<DataViewRow>();
  if (!v) return c.json({ error: 'not_found' }, 404);
  const counts = await c.env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM view_award WHERE view_id = ?) AS award_count,
      (SELECT COUNT(*) FROM view_access WHERE view_id = ? AND status = 'requested') AS pending_requests,
      (SELECT COUNT(*) FROM view_access WHERE view_id = ? AND status = 'granted') AS granted_users
  `).bind(id, id, id).first<{ award_count: number; pending_requests: number; granted_users: number }>();
  return c.json({ ...shapeView(v), counts: counts ?? { award_count: 0, pending_requests: 0, granted_users: 0 } });
});

// Create
adminViewsApp.post('/', async (c) => {
  const body = await c.req.json().catch(() => null) as
    | { name?: string; description?: string; enabled?: boolean; filters?: unknown }
    | null;
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'name_required' }, 400);
  }
  let filters: ViewFilters;
  try {
    filters = parseFilters(body.filters ?? {});
  } catch (e) {
    return c.json({ error: 'invalid_filters', detail: String(e instanceof Error ? e.message : e) }, 400);
  }
  const now = nowIso();
  const view_id = newId();
  await c.env.DB.prepare(`
    INSERT INTO data_view (view_id, name, description, enabled, filters_json, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    view_id, body.name.trim(), body.description ?? null,
    body.enabled === false ? 0 : 1, serializeFilters(filters),
    c.var.user!.user_id, now, now,
  ).run();
  return c.json({ view_id, name: body.name.trim(), filters, enabled: body.enabled !== false }, 201);
});

// Update
adminViewsApp.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null) as
    | { name?: string; description?: string; enabled?: boolean; filters?: unknown }
    | null;
  if (!body) return c.json({ error: 'invalid_body' }, 400);

  const existing = await c.env.DB.prepare('SELECT * FROM data_view WHERE view_id = ?')
    .bind(id).first<DataViewRow>();
  if (!existing) return c.json({ error: 'not_found' }, 404);

  let filters: ViewFilters | undefined;
  if (body.filters !== undefined) {
    try { filters = parseFilters(body.filters); }
    catch (e) { return c.json({ error: 'invalid_filters', detail: String(e instanceof Error ? e.message : e) }, 400); }
  }

  const next = {
    name:        body.name        !== undefined ? String(body.name).trim() : existing.name,
    description: body.description !== undefined ? body.description ?? null : existing.description,
    enabled:     body.enabled     !== undefined ? (body.enabled ? 1 : 0)   : existing.enabled,
    filters_json: filters         !== undefined ? serializeFilters(filters) : existing.filters_json,
  };
  await c.env.DB.prepare(`
    UPDATE data_view
    SET name = ?, description = ?, enabled = ?, filters_json = ?, updated_at = ?
    WHERE view_id = ?
  `).bind(next.name, next.description, next.enabled, next.filters_json, nowIso(), id).run();

  return c.json({ ok: true });
});

// Delete (cascades view_award + view_access via FK)
adminViewsApp.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM data_view WHERE view_id = ?').bind(id).run();
  return c.json({ ok: true });
});

// =================================================================
// Admin: access request review — /admin/access-requests/*
// =================================================================

export const adminAccessApp = new Hono<Ctx>();
adminAccessApp.use('*', requireAdmin);

// List all access rows; default to pending
adminAccessApp.get('/', async (c) => {
  const status = c.req.query('status') ?? 'requested';
  const where  = status === 'all' ? '' : 'WHERE va.status = ?';
  const params = status === 'all' ? [] : [status];
  const r = await c.env.DB.prepare(`
    SELECT va.*,
           u.email AS user_email, u.display_name AS user_display_name, u.avatar_url AS user_avatar_url,
           dv.name AS view_name
    FROM view_access va
    JOIN app_user  u  ON u.user_id = va.user_id
    JOIN data_view dv ON dv.view_id = va.view_id
    ${where}
    ORDER BY va.requested_at DESC
    LIMIT 500
  `).bind(...params).all();
  return c.json({ count: r.results.length, results: r.results });
});

adminAccessApp.post('/:id/grant', async (c) => {
  return decide(c, c.req.param('id'), 'granted');
});
adminAccessApp.post('/:id/deny', async (c) => {
  return decide(c, c.req.param('id'), 'denied');
});
adminAccessApp.post('/:id/revoke', async (c) => {
  return decide(c, c.req.param('id'), 'revoked');
});

async function decide(
  c: Context<Ctx>,
  accessId: string,
  status: 'granted' | 'denied' | 'revoked',
) {
  const body = await c.req.json().catch(() => ({})) as { decision_note?: string };
  const exists = await c.env.DB.prepare('SELECT access_id FROM view_access WHERE access_id = ?')
    .bind(accessId).first();
  if (!exists) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare(`
    UPDATE view_access
    SET status = ?, decided_at = ?, decided_by = ?, decision_note = ?
    WHERE access_id = ?
  `).bind(status, nowIso(), c.var.user!.user_id, body.decision_note ?? null, accessId).run();
  return c.json({ ok: true, access_id: accessId, status });
}

// =================================================================
// User routes — /views/*
// (any approved user; pending users are blocked by requireApproved
// middleware mounted in index.ts)
// =================================================================

export const userViewsApp = new Hono<Ctx>();
userViewsApp.use('*', requireApproved);

// All enabled views, with the calling user's access status (if any) on each.
//
// Every row also carries the current `award_count` (rows in view_award) so
// the UI can show "still empty / 1,234 awards" without a second round-trip.
//
// For admins, we additionally include a `latest_request` snippet — the most
// recent Run Now request for the view (status, attempt, decision time). This
// lets the Browse Views card surface "running / queued / failed / never run"
// without the admin needing to switch pages.
userViewsApp.get('/', async (c) => {
  const userId = c.var.user!.user_id;
  const isAdmin = c.var.user!.role === 'admin';

  const r = await c.env.DB.prepare(`
    SELECT
      dv.view_id, dv.name, dv.description, dv.filters_json,
      va.access_id, va.status, va.requested_at, va.decided_at,
      (SELECT COUNT(*) FROM view_award WHERE view_id = dv.view_id) AS award_count
    FROM data_view dv
    LEFT JOIN view_access va ON va.view_id = dv.view_id AND va.user_id = ?
    WHERE dv.enabled = 1
    ORDER BY dv.name ASC
  `).bind(userId).all<{
    view_id: string;
    name: string;
    description: string | null;
    filters_json: string;
    access_id: string | null;
    status: 'requested' | 'granted' | 'denied' | 'revoked' | null;
    requested_at: string | null;
    decided_at: string | null;
    award_count: number;
  }>();

  // For admins, fetch the most recent run request per view in a single round-trip.
  let latestByView = new Map<string, {
    request_id: string; status: string; attempt: number; max_attempts: number;
    requested_at: string; next_attempt_at: string;
    started_at: string | null; finished_at: string | null;
    error_message: string | null;
  }>();
  if (isAdmin) {
    const lr = await c.env.DB.prepare(`
      SELECT vrq.* FROM view_run_request vrq
      INNER JOIN (
        SELECT view_id, MAX(requested_at) AS max_at
        FROM view_run_request GROUP BY view_id
      ) x ON x.view_id = vrq.view_id AND x.max_at = vrq.requested_at
    `).all<{
      view_id: string; request_id: string; status: string;
      attempt: number; max_attempts: number;
      requested_at: string; next_attempt_at: string;
      started_at: string | null; finished_at: string | null;
      error_message: string | null;
    }>();
    latestByView = new Map(lr.results.map((row) => [row.view_id, {
      request_id: row.request_id, status: row.status,
      attempt: row.attempt, max_attempts: row.max_attempts,
      requested_at: row.requested_at, next_attempt_at: row.next_attempt_at,
      started_at: row.started_at, finished_at: row.finished_at,
      error_message: row.error_message,
    }]));
  }

  return c.json({
    count: r.results.length,
    results: r.results.map((row) => ({
      view_id:      row.view_id,
      name:         row.name,
      description:  row.description,
      filters:      deserializeFilters(row.filters_json),
      award_count:  row.award_count ?? 0,
      access:       row.access_id ? {
        access_id:    row.access_id,
        status:       row.status,
        requested_at: row.requested_at,
        decided_at:   row.decided_at,
      } : null,
      latest_request: latestByView.get(row.view_id) ?? null,
    })),
  });
});

// Request access (idempotent: re-requests reset a denied/revoked row to 'requested')
userViewsApp.post('/:id/request', async (c) => {
  const viewId = c.req.param('id');
  const userId = c.var.user!.user_id;
  const body = await c.req.json().catch(() => ({})) as { note?: string };

  const view = await c.env.DB.prepare('SELECT view_id, enabled FROM data_view WHERE view_id = ?')
    .bind(viewId).first<{ view_id: string; enabled: number }>();
  if (!view) return c.json({ error: 'not_found' }, 404);
  if (!view.enabled) return c.json({ error: 'view_disabled' }, 400);

  const existing = await c.env.DB.prepare(
    'SELECT access_id, status FROM view_access WHERE view_id = ? AND user_id = ?',
  ).bind(viewId, userId).first<{ access_id: string; status: AccessRow['status'] }>();

  const now = nowIso();
  if (existing) {
    if (existing.status === 'granted')   return c.json({ ok: true, access_id: existing.access_id, status: 'granted' });
    if (existing.status === 'requested') return c.json({ ok: true, access_id: existing.access_id, status: 'requested' });
    // denied / revoked → reset to 'requested'
    await c.env.DB.prepare(`
      UPDATE view_access
      SET status = 'requested', requested_at = ?, requested_note = ?,
          decided_at = NULL, decided_by = NULL, decision_note = NULL
      WHERE access_id = ?
    `).bind(now, body.note ?? null, existing.access_id).run();
    return c.json({ ok: true, access_id: existing.access_id, status: 'requested' });
  }

  const accessId = newId();
  await c.env.DB.prepare(`
    INSERT INTO view_access (access_id, view_id, user_id, status, requested_at, requested_note)
    VALUES (?, ?, ?, 'requested', ?, ?)
  `).bind(accessId, viewId, userId, now, body.note ?? null).run();
  return c.json({ ok: true, access_id: accessId, status: 'requested' }, 201);
});

// =================================================================
// Helpers used by data endpoints (awards, vendors, stats…)
// =================================================================

/**
 * Load a view by id IF the user has 'granted' access (or is an admin, who
 * implicitly has access to all views). Returns null when user is not
 * authorized — caller should respond 403.
 */
export async function loadAccessibleView(
  db: D1Database,
  viewId: string,
  userId: string,
  isAdmin: boolean,
): Promise<{ view_id: string; name: string; filters: ViewFilters } | null> {
  const v = await db.prepare(
    'SELECT view_id, name, filters_json, enabled FROM data_view WHERE view_id = ?',
  ).bind(viewId).first<{ view_id: string; name: string; filters_json: string; enabled: number }>();
  if (!v) return null;
  if (!v.enabled && !isAdmin) return null;

  if (!isAdmin) {
    const a = await db.prepare(
      `SELECT 1 AS ok FROM view_access WHERE view_id = ? AND user_id = ? AND status = 'granted'`,
    ).bind(viewId, userId).first<{ ok: number }>();
    if (!a) return null;
  }
  return {
    view_id: v.view_id,
    name: v.name,
    filters: deserializeFilters(v.filters_json),
  };
}

/**
 * For a given user, return all view_ids they can read.
 * Admin → all enabled views.
 * Regular user → views with granted access.
 */
export async function listAccessibleViewIds(
  db: D1Database,
  userId: string,
  isAdmin: boolean,
): Promise<string[]> {
  if (isAdmin) {
    const r = await db.prepare('SELECT view_id FROM data_view WHERE enabled = 1').all<{ view_id: string }>();
    return r.results.map((row) => row.view_id);
  }
  const r = await db.prepare(`
    SELECT dv.view_id
    FROM view_access va
    JOIN data_view dv ON dv.view_id = va.view_id AND dv.enabled = 1
    WHERE va.user_id = ? AND va.status = 'granted'
  `).bind(userId).all<{ view_id: string }>();
  return r.results.map((row) => row.view_id);
}
