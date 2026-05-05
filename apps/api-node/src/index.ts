/**
 * CaptureRadar API entry point — Hono on Node.
 *
 * Boot sequence:
 *   1. Validate env (z-parsed; aborts the process on failure)
 *   2. Mount routes — health, auth, opportunities, awards, ...
 *   3. Optionally mount Bull Board at /admin/queues (admin-only)
 *   4. Listen on PORT (defaults 3000); nginx on the VM proxies 443→3000
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { loadEnv, isProduction } from './env.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { oppRoutes } from './routes/opportunities.js';
import { stubRoutes } from './routes/stub.js';
import { mountBullBoard } from './queues/dashboard.js';

const env = loadEnv();

const app = new Hono();

app.use('*', logger());
app.use('*', secureHeaders());

app.use('*', cors({
  origin: env.CORS_ORIGINS,
  credentials: true,
  allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['X-Total-Count', 'X-Next-Cursor'],
  maxAge: 600,
}));

// ─── Health / readiness ────────────────────────────────────────────────────
app.route('/health', healthRoutes);

// ─── Auth (session lookup; OAuth issuance still on CF Worker) ──────────────
app.route('/auth', authRoutes);

// ─── Opportunities (contract + grant + forecasts) — Phase 1 first ─────────
app.route('/opportunities', oppRoutes);

// ─── Phase 1 stub list endpoints (empty until ingestion seeded) ───────────
app.route('/v1', stubRoutes);

// ─── BullMQ admin dashboard (admin-only; mounted only if Redis is configured) ──
mountBullBoard(app);

// ─── 404 + error handlers ─────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404));

app.onError((err, c) => {
  console.error('api unhandled error:', err);
  if (isProduction()) {
    return c.json({ error: 'internal_error' }, 500);
  }
  return c.json({ error: 'internal_error', message: err.message, stack: err.stack }, 500);
});

// ─── Start ─────────────────────────────────────────────────────────────────
const port = env.PORT;
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`captureradar api listening on http://0.0.0.0:${info.port}`);
});

export type AppType = typeof app;
