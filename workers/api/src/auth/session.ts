/**
 * Session helpers — D1-backed sessions with HTTP-only cookies.
 * No JWTs, no signing — the session_id IS the secret. If an attacker has it,
 * they're you, so it's transmitted over HTTPS only and stored in an
 * HTTP-only cookie that JavaScript can't read.
 */

import type { Context, Next } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';

export const SESSION_COOKIE = 'awards_session';
export const SESSION_TTL_DAYS = 30;

export type Role = 'pending' | 'user' | 'admin' | 'rejected';

export interface AppUser {
  user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  provider: string;
  provider_sub: string;
  role: Role;
  approved_by: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export type AuthVars = {
  user?: AppUser;
};

/** Generate a cryptographically random session id. */
export function newSessionId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Generate a UUID for app_user.user_id. */
export function newUserId(): string {
  return crypto.randomUUID();
}

/** Now as ISO. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Now plus N days as ISO. */
export function expiresIn(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/**
 * Create a session row + set cookie.
 */
export async function createSession(
  c: Context<{ Bindings: { DB: D1Database } }>,
  userId: string,
): Promise<string> {
  const sessionId = newSessionId();
  const expires = expiresIn(SESSION_TTL_DAYS);
  await c.env.DB.prepare(`
    INSERT INTO app_session (session_id, user_id, expires_at, created_at, user_agent, ip, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    sessionId,
    userId,
    expires,
    nowIso(),
    (c.req.header('user-agent') ?? '').slice(0, 500),
    c.req.header('cf-connecting-ip') ?? null,
    nowIso(),
  ).run();

  // The dashboard reaches this worker via a Pages Function proxy on the same
  // origin (awards-dashboard.pages.dev), so the cookie is first-party. Lax is
  // the right default — strict enough to thwart CSRF, lax enough to survive
  // top-level OAuth redirects back from Google/Microsoft.
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });

  return sessionId;
}

/** Look up the current user from cookie. Returns null if no/invalid session. */
export async function loadSession(
  c: Context<{ Bindings: { DB: D1Database } }>,
): Promise<AppUser | null> {
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (!sessionId) return null;

  const row = await c.env.DB.prepare(`
    SELECT u.*
    FROM app_session s
    JOIN app_user u ON u.user_id = s.user_id
    WHERE s.session_id = ? AND datetime(s.expires_at) > datetime('now')
  `).bind(sessionId).first<AppUser>();

  if (!row) return null;

  // Best-effort touch last_seen_at; non-blocking.
  c.executionCtx.waitUntil(
    c.env.DB.prepare('UPDATE app_session SET last_seen_at = ? WHERE session_id = ?')
      .bind(nowIso(), sessionId).run().then(() => {}, () => {}),
  );

  return row;
}

export async function destroySession(
  c: Context<{ Bindings: { DB: D1Database } }>,
): Promise<void> {
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (sessionId) {
    await c.env.DB.prepare('DELETE FROM app_session WHERE session_id = ?').bind(sessionId).run();
  }
  // Match the attributes used when setting the cookie, otherwise the browser
  // won't recognize this delete as targeting the same cookie.
  deleteCookie(c, SESSION_COOKIE, {
    path: '/',
    secure: true,
    sameSite: 'None',
  });
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/** Hydrates c.var.user if a session cookie is present. Never blocks. */
export async function authMiddleware(
  c: Context<{ Bindings: { DB: D1Database }; Variables: AuthVars }>,
  next: Next,
): Promise<void | Response> {
  const user = await loadSession(c);
  if (user) c.set('user', user);
  await next();
}

/** Returns 401 unless the user is signed in (any role). */
export async function requireAuth(
  c: Context<{ Bindings: { DB: D1Database }; Variables: AuthVars }>,
  next: Next,
): Promise<void | Response> {
  if (!c.var.user) return c.json({ error: 'unauthenticated' }, 401);
  await next();
}

/** Returns 403 for pending/rejected; passes for user/admin. */
export async function requireApproved(
  c: Context<{ Bindings: { DB: D1Database }; Variables: AuthVars }>,
  next: Next,
): Promise<void | Response> {
  const u = c.var.user;
  if (!u) return c.json({ error: 'unauthenticated' }, 401);
  if (u.role === 'pending')  return c.json({ error: 'pending_approval' }, 403);
  if (u.role === 'rejected') return c.json({ error: 'access_denied' }, 403);
  await next();
}

/** Admin-only middleware. */
export async function requireAdmin(
  c: Context<{ Bindings: { DB: D1Database }; Variables: AuthVars }>,
  next: Next,
): Promise<void | Response> {
  if (c.var.user?.role !== 'admin') return c.json({ error: 'admin_only' }, 403);
  await next();
}
