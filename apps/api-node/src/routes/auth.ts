/**
 * Auth routes — session lookup endpoint for the SPA.
 *
 * Sign-in / sign-out (Google + Microsoft OAuth) is still issued by the
 * Cloudflare Worker (workers/api/src/auth/routes.ts). The Worker writes the
 * `app_session` row and sets the cookie; we read both here.
 *
 *   GET  /auth/me      → { authenticated, user }
 *   POST /auth/logout  → destroys session row + clears cookie
 */
import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { getCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { app_session } from '../db/schema/index.js';
import { authMiddleware, type AuthVars } from '../auth/session.js';
import { loadEnv } from '../env.js';

const env = loadEnv();
export const authRoutes = new Hono<{ Variables: AuthVars }>();

authRoutes.use('*', authMiddleware);

authRoutes.get('/me', (c) => {
  const u = c.var.user;
  if (!u) return c.json({ authenticated: false }, 200);
  return c.json({
    authenticated: true,
    user: {
      user_id:        u.user_id,
      org_id:         u.org_id,
      email:          u.email,
      display_name:   u.display_name,
      avatar_url:     u.avatar_url,
      provider:       u.provider,
      role:           u.role,
      created_at:     u.created_at,
      last_login_at:  u.last_login_at,
    },
  });
});

authRoutes.post('/logout', async (c) => {
  const sid = getCookie(c, env.SESSION_COOKIE);
  if (sid) {
    await db.delete(app_session).where(eq(app_session.session_id, sid));
  }
  // Match attributes used at issuance — different SameSite means the browser
  // won't recognize this delete.
  setCookie(c, env.SESSION_COOKIE, '', {
    path: '/', secure: true, sameSite: 'Lax', httpOnly: true, maxAge: 0,
  });
  return c.json({ ok: true });
});
