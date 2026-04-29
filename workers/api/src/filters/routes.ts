/**
 * Filters API:
 *   - Admin CRUD on data_filter
 *   - Admin review of filter access requests
 *   - Approved-user request flow
 *   - Helpers (loadAccessibleFilter, listAccessibleFilterIds) consumed by
 *     data endpoints (parallel to the legacy view helpers).
 *
 * Same access workflow as views — only the underlying tables differ
 * (data_filter / filter_access). Filter scopes are query-time-only; no
 * M2M tagging into awards (compare data_view + view_award).
 */

import { Hono, type Context } from 'hono';
import { nowIso, requireAdmin, requireApproved, type AuthVars } from '../auth/session.js';
import { parseFilters, deserializeFilters, serializeFilters, type ViewFilters } from '../views/filters.js';

export interface FiltersEnv {
  DB: D1Database;
}

type Ctx = { Bindings: FiltersEnv; Variables: AuthVars };

interface DataFilterRow {
  filter_id: string;
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
  filter_id: string;
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

function shapeFilter(row: DataFilterRow) {
  return {
    filter_id: row.filter_id,
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
// Admin routes — /admin/filters/*
// =================================================================

export const adminFiltersApp = new Hono<Ctx>();
adminFiltersApp.use('*', requireAdmin);

adminFiltersApp.get('/', async (c) => {
  const r = await c.env.DB.prepare(`
    SELECT * FROM data_filter ORDER BY created_at DESC
  `).all<DataFilterRow>();
  return c.json({ count: r.results.length, results: r.results.map(shapeFilter) });
});

adminFiltersApp.get('/:id', async (c) => {
  const id = c.req.param('id');
  const v = await c.env.DB.prepare('SELECT * FROM data_filter WHERE filter_id = ?')
    .bind(id).first<DataFilterRow>();
  if (!v) return c.json({ error: 'not_found' }, 404);
  const counts = await c.env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM filter_access WHERE filter_id = ? AND status = 'requested') AS pending_requests,
      (SELECT COUNT(*) FROM filter_access WHERE filter_id = ? AND status = 'granted') AS granted_users
  `).bind(id, id).first<{ pending_requests: number; granted_users: number }>();
  return c.json({ ...shapeFilter(v), counts: counts ?? { pending_requests: 0, granted_users: 0 } });
});

adminFiltersApp.post('/', async (c) => {
  const body = await c.req.json().catch(() => null) as
    | { name?: string; description?: string; enabled?: boolean; filters?: unknown }
    | null;
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'name_required' }, 400);
  }
  let filters: ViewFilters;
  try { filters = parseFilters(body.filters ?? {}); }
  catch (e) {
    return c.json({ error: 'invalid_filters', detail: String(e instanceof Error ? e.message : e) }, 400);
  }
  const now = nowIso();
  const filter_id = newId();
  await c.env.DB.prepare(`
    INSERT INTO data_filter (filter_id, name, description, enabled, filters_json, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    filter_id, body.name.trim(), body.description ?? null,
    body.enabled === false ? 0 : 1, serializeFilters(filters),
    c.var.user!.user_id, now, now,
  ).run();
  return c.json({ filter_id, name: body.name.trim(), filters, enabled: body.enabled !== false }, 201);
});

adminFiltersApp.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null) as
    | { name?: string; description?: string; enabled?: boolean; filters?: unknown }
    | null;
  if (!body) return c.json({ error: 'invalid_body' }, 400);

  const existing = await c.env.DB.prepare('SELECT * FROM data_filter WHERE filter_id = ?')
    .bind(id).first<DataFilterRow>();
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
    UPDATE data_filter
    SET name = ?, description = ?, enabled = ?, filters_json = ?, updated_at = ?
    WHERE filter_id = ?
  `).bind(next.name, next.description, next.enabled, next.filters_json, nowIso(), id).run();

  return c.json({ ok: true });
});

adminFiltersApp.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM data_filter WHERE filter_id = ?').bind(id).run();
  return c.json({ ok: true });
});

// =================================================================
// Admin: filter access request review — /admin/filter-access-requests/*
// =================================================================

export const adminFilterAccessApp = new Hono<Ctx>();
adminFilterAccessApp.use('*', requireAdmin);

adminFilterAccessApp.get('/', async (c) => {
  const status = c.req.query('status') ?? 'requested';
  const where  = status === 'all' ? '' : 'WHERE fa.status = ?';
  const params = status === 'all' ? [] : [status];
  const r = await c.env.DB.prepare(`
    SELECT fa.*,
           u.email AS user_email, u.display_name AS user_display_name, u.avatar_url AS user_avatar_url,
           df.name AS filter_name
    FROM filter_access fa
    JOIN app_user   u  ON u.user_id     = fa.user_id
    JOIN data_filter df ON df.filter_id = fa.filter_id
    ${where}
    ORDER BY fa.requested_at DESC
    LIMIT 500
  `).bind(...params).all();
  return c.json({ count: r.results.length, results: r.results });
});

adminFilterAccessApp.post('/:id/grant',  async (c) => decideFA(c, c.req.param('id'), 'granted'));
adminFilterAccessApp.post('/:id/deny',   async (c) => decideFA(c, c.req.param('id'), 'denied'));
adminFilterAccessApp.post('/:id/revoke', async (c) => decideFA(c, c.req.param('id'), 'revoked'));

async function decideFA(
  c: Context<Ctx>,
  accessId: string,
  status: 'granted' | 'denied' | 'revoked',
) {
  const body = await c.req.json().catch(() => ({})) as { decision_note?: string };
  const exists = await c.env.DB.prepare('SELECT access_id FROM filter_access WHERE access_id = ?')
    .bind(accessId).first();
  if (!exists) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare(`
    UPDATE filter_access
    SET status = ?, decided_at = ?, decided_by = ?, decision_note = ?
    WHERE access_id = ?
  `).bind(status, nowIso(), c.var.user!.user_id, body.decision_note ?? null, accessId).run();
  return c.json({ ok: true, access_id: accessId, status });
}

// =================================================================
// User routes — /filters/*
// =================================================================

export const userFiltersApp = new Hono<Ctx>();
userFiltersApp.use('*', requireApproved);

userFiltersApp.get('/', async (c) => {
  const userId = c.var.user!.user_id;

  const r = await c.env.DB.prepare(`
    SELECT
      df.filter_id, df.name, df.description, df.filters_json,
      fa.access_id, fa.status, fa.requested_at, fa.decided_at
    FROM data_filter df
    LEFT JOIN filter_access fa ON fa.filter_id = df.filter_id AND fa.user_id = ?
    WHERE df.enabled = 1
    ORDER BY df.name ASC
  `).bind(userId).all<{
    filter_id: string;
    name: string;
    description: string | null;
    filters_json: string;
    access_id: string | null;
    status: 'requested' | 'granted' | 'denied' | 'revoked' | null;
    requested_at: string | null;
    decided_at: string | null;
  }>();

  return c.json({
    count: r.results.length,
    results: r.results.map((row) => ({
      filter_id:   row.filter_id,
      name:        row.name,
      description: row.description,
      filters:     deserializeFilters(row.filters_json),
      access:      row.access_id ? {
        access_id:    row.access_id,
        status:       row.status,
        requested_at: row.requested_at,
        decided_at:   row.decided_at,
      } : null,
    })),
  });
});

userFiltersApp.post('/:id/request', async (c) => {
  const filterId = c.req.param('id');
  const userId = c.var.user!.user_id;
  const body = await c.req.json().catch(() => ({})) as { note?: string };

  const filter = await c.env.DB.prepare('SELECT filter_id, enabled FROM data_filter WHERE filter_id = ?')
    .bind(filterId).first<{ filter_id: string; enabled: number }>();
  if (!filter) return c.json({ error: 'not_found' }, 404);
  if (!filter.enabled) return c.json({ error: 'filter_disabled' }, 400);

  const existing = await c.env.DB.prepare(
    'SELECT access_id, status FROM filter_access WHERE filter_id = ? AND user_id = ?',
  ).bind(filterId, userId).first<{ access_id: string; status: AccessRow['status'] }>();

  const now = nowIso();
  if (existing) {
    if (existing.status === 'granted')   return c.json({ ok: true, access_id: existing.access_id, status: 'granted' });
    if (existing.status === 'requested') return c.json({ ok: true, access_id: existing.access_id, status: 'requested' });
    await c.env.DB.prepare(`
      UPDATE filter_access
      SET status = 'requested', requested_at = ?, requested_note = ?,
          decided_at = NULL, decided_by = NULL, decision_note = NULL
      WHERE access_id = ?
    `).bind(now, body.note ?? null, existing.access_id).run();
    return c.json({ ok: true, access_id: existing.access_id, status: 'requested' });
  }

  const accessId = newId();
  await c.env.DB.prepare(`
    INSERT INTO filter_access (access_id, filter_id, user_id, status, requested_at, requested_note)
    VALUES (?, ?, ?, 'requested', ?, ?)
  `).bind(accessId, filterId, userId, now, body.note ?? null).run();
  return c.json({ ok: true, access_id: accessId, status: 'requested' }, 201);
});

// =================================================================
// Helpers used by data endpoints
// =================================================================

export interface AccessibleFilter {
  filter_id: string;
  name: string;
  filters: ViewFilters;
}

export async function loadAccessibleFilter(
  db: D1Database,
  filterId: string,
  userId: string,
  isAdmin: boolean,
): Promise<AccessibleFilter | null> {
  const v = await db.prepare(
    'SELECT filter_id, name, filters_json, enabled FROM data_filter WHERE filter_id = ?',
  ).bind(filterId).first<{ filter_id: string; name: string; filters_json: string; enabled: number }>();
  if (!v) return null;
  if (!v.enabled && !isAdmin) return null;

  if (!isAdmin) {
    const a = await db.prepare(
      `SELECT 1 AS ok FROM filter_access WHERE filter_id = ? AND user_id = ? AND status = 'granted'`,
    ).bind(filterId, userId).first<{ ok: number }>();
    if (!a) return null;
  }
  return {
    filter_id: v.filter_id,
    name: v.name,
    filters: deserializeFilters(v.filters_json),
  };
}

export async function listAccessibleFilterIds(
  db: D1Database,
  userId: string,
  isAdmin: boolean,
): Promise<string[]> {
  if (isAdmin) {
    const r = await db.prepare('SELECT filter_id FROM data_filter WHERE enabled = 1').all<{ filter_id: string }>();
    return r.results.map((row) => row.filter_id);
  }
  const r = await db.prepare(`
    SELECT df.filter_id
    FROM filter_access fa
    JOIN data_filter df ON df.filter_id = fa.filter_id AND df.enabled = 1
    WHERE fa.user_id = ? AND fa.status = 'granted'
  `).bind(userId).all<{ filter_id: string }>();
  return r.results.map((row) => row.filter_id);
}
