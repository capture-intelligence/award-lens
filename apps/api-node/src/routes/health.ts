/**
 * Health + readiness checks.
 *   GET /health        — liveness (process is up)
 *   GET /health/ready  — readiness (db + redis reachable)
 */
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { redis } from '../redis.js';

export const healthRoutes = new Hono();

healthRoutes.get('/', (c) => c.json({ ok: true, service: 'captureradar-api', ts: new Date().toISOString() }));

healthRoutes.get('/ready', async (c) => {
  const checks: Record<string, { ok: boolean; latency_ms?: number; error?: string }> = {};

  // Postgres
  const t0 = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    checks.postgres = { ok: true, latency_ms: Date.now() - t0 };
  } catch (e) {
    checks.postgres = { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }

  // Redis
  const t1 = Date.now();
  try {
    const pong = await redis.ping();
    checks.redis = { ok: pong === 'PONG', latency_ms: Date.now() - t1 };
  } catch (e) {
    checks.redis = { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  return c.json({ ok: allOk, checks }, allOk ? 200 : 503);
});
