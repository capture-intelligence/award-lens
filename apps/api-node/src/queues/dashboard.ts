/**
 * Bull Board admin dashboard mounted at /admin/queues.
 * Admin-only — checks the session role before allowing access.
 *
 * Uses @bull-board/hono adapter so it lives inside the same Hono app.
 */
import type { Hono } from 'hono';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter.js';
import { HonoAdapter } from '@bull-board/hono';
import { allQueues } from './index.js';
import { authMiddleware, requireAdmin, type AuthVars } from '../auth/session.js';

export function mountBullBoard(app: Hono<{ Variables: AuthVars }>) {
  const serverAdapter = new HonoAdapter(serveStatic());
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: allQueues().map((q) => new BullMQAdapter(q)),
    serverAdapter,
  });

  // Gate the entire admin/queues subtree to admin role.
  app.use('/admin/queues/*', authMiddleware, requireAdmin);
  app.route('/admin/queues', serverAdapter.registerPlugin());
}

// HonoAdapter expects a serveStatic function; we don't expose static assets
// outside the dashboard, so a no-op stub is fine.
function serveStatic() {
  return () => async () => undefined;
}
