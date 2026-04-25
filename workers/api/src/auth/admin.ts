/**
 * Admin user-management endpoints.
 * All routes require role='admin' (see middleware in src/index.ts).
 */

import { Hono } from 'hono';
import { nowIso, requireAdmin, type AuthVars, type Role } from './session.js';

export interface AdminEnv {
  DB: D1Database;
}

export const adminUsersApp = new Hono<{ Bindings: AdminEnv; Variables: AuthVars }>();

adminUsersApp.use('*', requireAdmin);

// ─── GET /admin/users — list all users with their status ─────────────────────
adminUsersApp.get('/users', async (c) => {
  const role = c.req.query('role'); // optional filter
  const sql = role
    ? 'SELECT * FROM app_user WHERE role = ? ORDER BY created_at DESC LIMIT 500'
    : 'SELECT * FROM app_user ORDER BY created_at DESC LIMIT 500';
  const result = role
    ? await c.env.DB.prepare(sql).bind(role).all()
    : await c.env.DB.prepare(sql).all();
  return c.json({ count: result.results.length, results: result.results });
});

// ─── GET /admin/users/:id — single user with audit trail ─────────────────────
adminUsersApp.get('/users/:id', async (c) => {
  const id = c.req.param('id');
  const user = await c.env.DB.prepare('SELECT * FROM app_user WHERE user_id = ?').bind(id).first();
  if (!user) return c.json({ error: 'not_found' }, 404);
  const audit = await c.env.DB.prepare(`
    SELECT * FROM app_user_audit WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
  `).bind(id).all();
  return c.json({ user, audit: audit.results });
});

// ─── POST /admin/users/:id/approve ──────────────────────────────────────────
adminUsersApp.post('/users/:id/approve', async (c) => {
  const id = c.req.param('id');
  const actor = c.var.user!;
  const now = nowIso();

  const before = await c.env.DB.prepare('SELECT role FROM app_user WHERE user_id = ?')
    .bind(id).first<{ role: Role }>();
  if (!before) return c.json({ error: 'not_found' }, 404);

  await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE app_user
      SET role = 'user', approved_by = ?, approved_at = ?, rejected_at = NULL, updated_at = ?
      WHERE user_id = ?
    `).bind(actor.user_id, now, now, id),
    c.env.DB.prepare(`
      INSERT INTO app_user_audit (user_id, actor_id, action, from_role, to_role, created_at)
      VALUES (?, ?, 'approved', ?, 'user', ?)
    `).bind(id, actor.user_id, before.role, now),
  ]);
  return c.json({ ok: true, user_id: id, role: 'user' });
});

// ─── POST /admin/users/:id/reject ───────────────────────────────────────────
adminUsersApp.post('/users/:id/reject', async (c) => {
  const id = c.req.param('id');
  const actor = c.var.user!;
  const now = nowIso();
  const body = await c.req.json().catch(() => ({})) as { reason?: string };

  const before = await c.env.DB.prepare('SELECT role FROM app_user WHERE user_id = ?')
    .bind(id).first<{ role: Role }>();
  if (!before) return c.json({ error: 'not_found' }, 404);

  await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE app_user
      SET role = 'rejected', rejected_at = ?, updated_at = ?
      WHERE user_id = ?
    `).bind(now, now, id),
    c.env.DB.prepare(`
      INSERT INTO app_user_audit (user_id, actor_id, action, from_role, to_role, notes, created_at)
      VALUES (?, ?, 'rejected', ?, 'rejected', ?, ?)
    `).bind(id, actor.user_id, before.role, body.reason ?? null, now),
    // Invalidate any active sessions
    c.env.DB.prepare('DELETE FROM app_session WHERE user_id = ?').bind(id),
  ]);
  return c.json({ ok: true, user_id: id, role: 'rejected' });
});

// ─── POST /admin/users/:id/role ──────────────────────────────────────────────
// Body: { role: 'user' | 'admin' | 'pending' | 'rejected' }
adminUsersApp.post('/users/:id/role', async (c) => {
  const id = c.req.param('id');
  const actor = c.var.user!;
  const body = await c.req.json().catch(() => null) as { role?: Role; reason?: string } | null;
  const newRole = body?.role;
  if (!newRole || !['pending', 'user', 'admin', 'rejected'].includes(newRole)) {
    return c.json({ error: 'invalid_role' }, 400);
  }

  // Safety: don't let an admin demote themselves (would brick the system).
  if (id === actor.user_id && newRole !== 'admin') {
    return c.json({ error: 'cannot_demote_self' }, 400);
  }

  const before = await c.env.DB.prepare('SELECT role FROM app_user WHERE user_id = ?')
    .bind(id).first<{ role: Role }>();
  if (!before) return c.json({ error: 'not_found' }, 404);

  const now = nowIso();
  const stmts = [
    c.env.DB.prepare(`
      UPDATE app_user
      SET role = ?,
          approved_by = CASE WHEN ? IN ('user','admin') THEN ? ELSE approved_by END,
          approved_at = CASE WHEN ? IN ('user','admin') AND approved_at IS NULL THEN ? ELSE approved_at END,
          rejected_at = CASE WHEN ? = 'rejected' THEN ? ELSE NULL END,
          updated_at  = ?
      WHERE user_id = ?
    `).bind(newRole, newRole, actor.user_id, newRole, now, newRole, now, now, id),
    c.env.DB.prepare(`
      INSERT INTO app_user_audit (user_id, actor_id, action, from_role, to_role, notes, created_at)
      VALUES (?, ?, 'role_changed', ?, ?, ?, ?)
    `).bind(id, actor.user_id, before.role, newRole, body?.reason ?? null, now),
  ];
  // If demoted out of approved status, kill sessions.
  if (newRole === 'rejected' || newRole === 'pending') {
    stmts.push(c.env.DB.prepare('DELETE FROM app_session WHERE user_id = ?').bind(id));
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, user_id: id, role: newRole });
});

// ─── GET /admin/users/stats ─────────────────────────────────────────────────
adminUsersApp.get('/stats/users', async (c) => {
  const counts = await c.env.DB.prepare(`
    SELECT role, COUNT(*) AS n FROM app_user GROUP BY role
  `).all<{ role: Role; n: number }>();
  const byRole: Record<string, number> = { pending: 0, user: 0, admin: 0, rejected: 0 };
  for (const r of counts.results) byRole[r.role] = r.n;
  return c.json(byRole);
});
