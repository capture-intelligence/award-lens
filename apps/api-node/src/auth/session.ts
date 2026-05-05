/**
 * Session middleware for the Node API. Loads the session_id from the cookie
 * (set by the Cloudflare Worker), looks it up in Postgres, attaches the user
 * to the Hono context.
 *
 * The Worker (workers/api/src/auth) is the issuer; we are the verifier here.
 * Both share the same `app_session` and `app_user` tables in Postgres.
 */
import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { eq, gt, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { app_user, app_session } from '../db/schema/index.js';
import { loadEnv } from '../env.js';

const env = loadEnv();

export type Role = 'admin' | 'member' | 'viewer' | 'pending' | 'rejected' | 'user';

export interface AppUser {
  user_id: string;
  org_id: string | null;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  provider: string;
  role: Role;
  created_at: Date;
  last_login_at: Date | null;
}

export type AuthVars = {
  user?: AppUser;
};

/** Load the user from the session cookie. Returns null if no/invalid session. */
export async function loadSession(c: Context): Promise<AppUser | null> {
  const sessionId = getCookie(c, env.SESSION_COOKIE);
  if (!sessionId) return null;

  const rows = await db
    .select({
      user_id: app_user.user_id,
      org_id: app_user.org_id,
      email: app_user.email,
      display_name: app_user.display_name,
      avatar_url: app_user.avatar_url,
      provider: app_user.provider,
      role: app_user.role,
      created_at: app_user.created_at,
      last_login_at: app_user.last_login_at,
    })
    .from(app_session)
    .innerJoin(app_user, eq(app_user.user_id, app_session.user_id))
    .where(and(
      eq(app_session.session_id, sessionId),
      gt(app_session.expires_at, new Date()),
    ))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Best-effort touch last_seen_at; non-blocking.
  void db
    .update(app_session)
    .set({ last_seen_at: new Date() })
    .where(eq(app_session.session_id, sessionId))
    .catch(() => {});

  return row as AppUser;
}

// ─── Hono middleware ───────────────────────────────────────────────────────

/** Hydrates `c.var.user` if a session cookie is present. Never blocks. */
export async function authMiddleware(c: Context<{ Variables: AuthVars }>, next: Next) {
  const user = await loadSession(c);
  if (user) c.set('user', user);
  await next();
}

/** Returns 401 unless the user is signed in. */
export async function requireAuth(c: Context<{ Variables: AuthVars }>, next: Next) {
  if (!c.var.user) return c.json({ error: 'unauthenticated' }, 401);
  await next();
}

/** Returns 403 for pending/rejected. */
export async function requireApproved(c: Context<{ Variables: AuthVars }>, next: Next) {
  const u = c.var.user;
  if (!u) return c.json({ error: 'unauthenticated' }, 401);
  if (u.role === 'pending')  return c.json({ error: 'pending_approval' }, 403);
  if (u.role === 'rejected') return c.json({ error: 'access_denied' }, 403);
  await next();
}

/** Admin-only. */
export async function requireAdmin(c: Context<{ Variables: AuthVars }>, next: Next) {
  if (c.var.user?.role !== 'admin') return c.json({ error: 'admin_only' }, 403);
  await next();
}

/** Helper for routes that return 401 with a custom message. */
export function unauthorized(c: Context, msg = 'unauthenticated') {
  return c.json({ error: msg }, 401);
}
