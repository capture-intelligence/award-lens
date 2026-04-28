/**
 * OAuth routes — Google + Microsoft (Entra ID / Azure AD).
 * Uses @hono/oauth-providers as middleware that runs the redirect/callback
 * dance, then our handler upserts the user + creates a session.
 */

import { Hono, type Context } from 'hono';
import { googleAuth } from '@hono/oauth-providers/google';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import {
  createSession, destroySession, loadSession,
  newUserId, nowIso, type AppUser, type AuthVars,
} from './session.js';

export interface AuthEnv {
  DB: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  MICROSOFT_TENANT_ID?: string;
  /** Where to redirect the browser after a successful login. */
  AUTH_REDIRECT_URL?: string;
  /**
   * Public origin where the dashboard is served (e.g. https://awards-dashboard.pages.dev).
   * Used as the OAuth redirect_uri so callbacks come back through the Pages
   * proxy — that way the session cookie ends up first-party.
   */
  AUTH_PUBLIC_BASE_URL?: string;
}

const ADMIN_BOOTSTRAP_EMAIL = 'algocrat@gmail.com';
const FRONTEND_DEFAULT = 'https://awards-dashboard.pages.dev';

/**
 * Look up or create the user record from OIDC claims, then mint a session.
 * Auto-promotes the bootstrap admin email on first sign-in.
 */
async function upsertUserAndSignIn(
  c: Context<{ Bindings: AuthEnv; Variables: AuthVars }>,
  provider: 'google' | 'microsoft',
  claims: { email: string; sub: string; name?: string; picture?: string },
): Promise<AppUser> {
  const email = claims.email.toLowerCase();
  const now = nowIso();

  const existing = await c.env.DB.prepare(`
    SELECT * FROM app_user WHERE provider = ? AND provider_sub = ?
  `).bind(provider, claims.sub).first<AppUser>();

  if (existing) {
    await c.env.DB.prepare(`
      UPDATE app_user SET
        display_name  = COALESCE(?, display_name),
        avatar_url    = COALESCE(?, avatar_url),
        last_login_at = ?,
        updated_at    = ?
      WHERE user_id = ?
    `).bind(
      claims.name ?? null, claims.picture ?? null, now, now, existing.user_id,
    ).run();
    await createSession(c, existing.user_id);
    return { ...existing, last_login_at: now };
  }

  // Brand-new user. Bootstrap admin if it's the configured email.
  const role: 'pending' | 'admin' = email === ADMIN_BOOTSTRAP_EMAIL ? 'admin' : 'pending';
  const userId = newUserId();

  await c.env.DB.prepare(`
    INSERT INTO app_user
      (user_id, email, display_name, avatar_url, provider, provider_sub,
       role, approved_at, last_login_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    userId, email, claims.name ?? null, claims.picture ?? null,
    provider, claims.sub, role,
    role === 'admin' ? now : null, now, now, now,
  ).run();

  await c.env.DB.prepare(`
    INSERT INTO app_user_audit (user_id, actor_id, action, to_role, notes, created_at)
    VALUES (?, NULL, 'created', ?, ?, ?)
  `).bind(userId, role, role === 'admin' ? 'bootstrap admin' : 'self-registered', now).run();

  await createSession(c, userId);
  return {
    user_id: userId, email, display_name: claims.name ?? null,
    avatar_url: claims.picture ?? null, provider, provider_sub: claims.sub,
    role, approved_by: null, approved_at: role === 'admin' ? now : null,
    rejected_at: null, last_login_at: now, created_at: now, updated_at: now,
  };
}

export const authApp = new Hono<{ Bindings: AuthEnv; Variables: AuthVars }>();

// ─── /auth/me ────────────────────────────────────────────────────────────────
authApp.get('/me', async (c) => {
  const user = await loadSession(c);
  if (!user) return c.json({ authenticated: false }, 200);
  return c.json({
    authenticated: true,
    user: {
      user_id: user.user_id,
      email: user.email,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      provider: user.provider,
      role: user.role,
      created_at: user.created_at,
    },
  });
});

// ─── /auth/logout ────────────────────────────────────────────────────────────
authApp.post('/logout', async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

// ─── Google OAuth (single endpoint handles both redirect and callback) ──────
//
// Hono's googleAuth middleware:
//   • If the request has no `code` query param, redirects to Google
//   • If the request has a `code` (Google's callback), exchanges it,
//     sets `c.var.user-google` with the profile, calls next()
authApp.use('/google', async (c, next) => {
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) {
    return c.json({ error: 'google_oauth_not_configured' }, 503);
  }
  try {
    const publicBase = c.env.AUTH_PUBLIC_BASE_URL ?? FRONTEND_DEFAULT;
    return await googleAuth({
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      scope: ['openid', 'email', 'profile'],
      redirect_uri: `${publicBase}/auth/google`,
    })(c, next);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    console.error('google_auth_middleware_error:', msg);
    const url = new URL(c.env.AUTH_REDIRECT_URL ?? FRONTEND_DEFAULT);
    url.searchParams.set('auth_error', 'google_middleware');
    url.searchParams.set('detail', msg.slice(0, 200));
    return c.redirect(url.toString());
  }
});
authApp.get('/google', async (c) => {
  try {
    const profile = c.get('user-google') as
      | { id?: string; email?: string; name?: string; picture?: string }
      | undefined;
    console.log('google_handler: profile present=' + !!profile + ' keys=' + (profile ? Object.keys(profile).join(',') : 'none'));
    if (!profile?.email || !profile.id) {
      const url = new URL(c.env.AUTH_REDIRECT_URL ?? FRONTEND_DEFAULT);
      url.searchParams.set('auth_error', 'google_no_profile');
      url.searchParams.set('have_profile', String(!!profile));
      url.searchParams.set('have_email', String(!!profile?.email));
      url.searchParams.set('have_id', String(!!profile?.id));
      console.log('google_handler: redirecting with auth_error to ' + url.toString());
      return c.redirect(url.toString());
    }
    console.log('google_handler: upserting user email=' + profile.email);
    await upsertUserAndSignIn(c, 'google', {
      email: profile.email, sub: profile.id,
      name: profile.name, picture: profile.picture,
    });
    const target = c.env.AUTH_REDIRECT_URL ?? FRONTEND_DEFAULT;
    console.log('google_handler: SUCCESS, redirecting to ' + target);
    return c.redirect(target);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    console.error('google_auth_handler_error:', msg);
    const url = new URL(c.env.AUTH_REDIRECT_URL ?? FRONTEND_DEFAULT);
    url.searchParams.set('auth_error', 'google_handler');
    url.searchParams.set('detail', msg.slice(0, 200));
    return c.redirect(url.toString());
  }
});

// ─── Microsoft (Entra ID / Azure AD) ────────────────────────────────────────
// Manual OAuth 2.0 flow — @hono/oauth-providers doesn't ship a Microsoft
// provider in v0.6.x. We implement: redirect → callback → token exchange →
// Graph /me → upsert user → set session.
const MS_STATE_COOKIE = 'ms_oauth_state';

authApp.get('/microsoft', async (c) => {
  if (!c.env.MICROSOFT_CLIENT_ID || !c.env.MICROSOFT_CLIENT_SECRET) {
    return c.json({ error: 'microsoft_oauth_not_configured' }, 503);
  }
  const tenant = c.env.MICROSOFT_TENANT_ID ?? 'common';
  const code = c.req.query('code');
  const stateParam = c.req.query('state');
  // Use the public dashboard origin (Pages) as the OAuth redirect target so
  // the callback lands on a same-origin URL — the Pages Function then proxies
  // it to this worker. That keeps the session cookie first-party.
  const publicBase = c.env.AUTH_PUBLIC_BASE_URL ?? FRONTEND_DEFAULT;
  const redirectUri = `${publicBase}/auth/microsoft`;

  // ── Step 1: no code yet → kick off OAuth redirect ──────────────────────
  if (!code) {
    const state = crypto.randomUUID();
    setCookie(c, MS_STATE_COOKIE, state, {
      httpOnly: true, secure: true, sameSite: 'Lax', path: '/auth',
      maxAge: 600,
    });
    const authorize = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
    authorize.searchParams.set('client_id', c.env.MICROSOFT_CLIENT_ID);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('redirect_uri', redirectUri);
    authorize.searchParams.set('response_mode', 'query');
    authorize.searchParams.set('scope', 'openid email profile User.Read');
    authorize.searchParams.set('state', state);
    return c.redirect(authorize.toString());
  }

  // ── Step 2: callback with code → validate state, exchange for token ────
  const expectedState = getCookie(c, MS_STATE_COOKIE);
  deleteCookie(c, MS_STATE_COOKIE, { path: '/auth' });
  if (!expectedState || expectedState !== stateParam) {
    return c.redirect(`${c.env.AUTH_REDIRECT_URL ?? FRONTEND_DEFAULT}/?auth_error=microsoft_state_mismatch`);
  }

  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.env.MICROSOFT_CLIENT_ID,
      client_secret: c.env.MICROSOFT_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!tokenRes.ok) {
    return c.redirect(`${c.env.AUTH_REDIRECT_URL ?? FRONTEND_DEFAULT}/?auth_error=microsoft_token_${tokenRes.status}`);
  }
  const tok = await tokenRes.json() as { access_token?: string };
  if (!tok.access_token) {
    return c.redirect(`${c.env.AUTH_REDIRECT_URL ?? FRONTEND_DEFAULT}/?auth_error=microsoft_no_token`);
  }

  // ── Step 3: fetch profile from Microsoft Graph ─────────────────────────
  const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  });
  if (!meRes.ok) {
    return c.redirect(`${c.env.AUTH_REDIRECT_URL ?? FRONTEND_DEFAULT}/?auth_error=microsoft_graph_${meRes.status}`);
  }
  const profile = await meRes.json() as {
    id?: string; mail?: string; userPrincipalName?: string; displayName?: string;
  };
  const email = profile.mail ?? profile.userPrincipalName;
  if (!profile.id || !email) {
    return c.redirect(`${c.env.AUTH_REDIRECT_URL ?? FRONTEND_DEFAULT}/?auth_error=microsoft_no_profile`);
  }

  await upsertUserAndSignIn(c, 'microsoft', {
    email, sub: profile.id, name: profile.displayName,
  });
  return c.redirect(c.env.AUTH_REDIRECT_URL ?? FRONTEND_DEFAULT);
});
