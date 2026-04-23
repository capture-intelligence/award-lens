/**
 * Scheduler — fires workflows on cron triggers.
 * Add new sources here; each gets its own cron line in wrangler.toml.
 */

import { runReconciliation } from './reconciliation.js';
import { backfillToptierCodes } from './toptier-backfill.js';

export interface Env {
  DB: D1Database;
  META: KVNamespace;
  USASPENDING_WORKFLOW: Workflow;
  SAM_BULK_WORKFLOW: Workflow;
  GRANTS_GOV_WORKFLOW: Workflow;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`[scheduler] cron fired: ${event.cron}`);

    switch (event.cron) {
      case '0 6 * * *':
        ctx.waitUntil(
          env.USASPENDING_WORKFLOW.create({
            params: { mode: 'incremental' },
          }).then((i) => console.log(`[scheduler] usaspending workflow: ${i.id}`)),
        );
        break;

      case '15 7 * * *':
        ctx.waitUntil(
          env.SAM_BULK_WORKFLOW.create({
            params: { extracts: ['exclusions'] },
          }).then((i) => console.log(`[scheduler] sam-bulk workflow: ${i.id}`)),
        );
        break;

      case '30 8 * * *':
        ctx.waitUntil(
          env.GRANTS_GOV_WORKFLOW.create({
            params: { statuses: ['posted', 'forecasted'] },
          }).then((i) => console.log(`[scheduler] grants-gov workflow: ${i.id}`)),
        );
        break;

      case '0 12 * * SUN':
        ctx.waitUntil(
          runReconciliation(env.DB, env.META)
            .then((r) => console.log(`[scheduler] reconciliation:`, r)),
        );
        break;

      default:
        console.warn(`[scheduler] no handler for cron: ${event.cron}`);
    }
  },

  // Expose HTTP triggers for manual runs (protect with Cloudflare Access in prod).
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== 'POST') return new Response('scheduler-worker', { status: 200 });

    if (url.pathname === '/trigger/usaspending') {
      const body = await req.json().catch(() => ({}));
      const instance = await env.USASPENDING_WORKFLOW.create({
        params: body as Record<string, unknown>,
      });
      return Response.json({ id: instance.id });
    }
    if (url.pathname === '/trigger/sam-bulk') {
      const body = await req.json<{ extracts?: string[] }>().catch(() => ({}));
      const instance = await env.SAM_BULK_WORKFLOW.create({
        params: { extracts: body.extracts ?? ['exclusions'] },
      });
      return Response.json({ id: instance.id });
    }
    if (url.pathname === '/trigger/grants-gov') {
      const body = await req.json().catch(() => ({}));
      const instance = await env.GRANTS_GOV_WORKFLOW.create({
        params: body as Record<string, unknown>,
      });
      return Response.json({ id: instance.id });
    }
    if (url.pathname === '/trigger/reconcile') {
      const result = await runReconciliation(env.DB, env.META);
      return Response.json(result);
    }
    if (url.pathname === '/trigger/backfill-toptier-codes') {
      const result = await backfillToptierCodes(env.DB);
      return Response.json(result);
    }
    return new Response('unknown trigger', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
