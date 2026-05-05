/**
 * Pages Functions middleware — same-origin proxy that splits API traffic
 * between the legacy Cloudflare Worker (auth issuance + legacy D1 routes)
 * and the new Node API on the Oracle VM (Phase 1 data layer).
 *
 * Why same-origin: Edge Tracking Prevention, Safari ITP, and Chrome's
 * third-party cookie phase-out silently drop cookies set on a different
 * origin. Routing both APIs through the dashboard's own origin makes the
 * session cookie first-party.
 *
 * Routing:
 *   /auth/*                                       → CF Worker (OAuth issuance)
 *   /admin/users, /admin/access-requests, /admin/  → CF Worker (legacy admin)
 *   /opportunities/*, /v1/*, /admin/queues/*       → Node API (data layer)
 *   anything else listed                           → CF Worker (legacy data)
 *   unmatched                                      → static SPA (context.next())
 */

interface Env {
  /** Node API origin — set in Pages env. Falls back to CF Worker if absent. */
  NODE_API_ORIGIN?: string;
}

// Paths owned by the new Node API (Postgres + BullMQ on Oracle VM).
const NODE_API_PREFIXES = [
  '/opportunities',
  '/v1',
  '/admin/queues',
] as const;

// Paths still served by the CF Worker (workers/api). Cutover happens path-
// by-path as the Node API gains coverage.
const CF_WORKER_PREFIXES = [
  '/auth',
  '/admin',
  '/awards',
  '/vendors',
  '/organizations',
  '/runs',
  '/stats',
  '/exclusions',
  '/reconciliation',
  '/schedule',
  '/sam-api',
  '/import',
  '/diag',
  '/health',
  '/views',
  '/filters',
  '/awarding-agencies',
  '/centers',
  '/explore',
  '/ai',
] as const;

const CF_WORKER_ORIGIN = 'https://api-worker.algocrat.workers.dev';

function findUpstream(pathname: string, env: Env): string | null {
  // Node API takes precedence — its prefixes are more specific (/admin/queues
  // matches before /admin).
  for (const p of NODE_API_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + '/')) {
      return env.NODE_API_ORIGIN ?? CF_WORKER_ORIGIN; // fall back to worker for Phase 0
    }
  }
  for (const p of CF_WORKER_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + '/')) {
      return CF_WORKER_ORIGIN;
    }
  }
  return null;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const upstreamOrigin = findUpstream(url.pathname, context.env);

  if (!upstreamOrigin) {
    return context.next();
  }

  const upstream = new URL(url.pathname + url.search, upstreamOrigin);

  // Clone the incoming request, but rewrite the URL. We must NOT forward the
  // browser's Host header — fetch() sets the right Host automatically when
  // given a fresh URL.
  const upstreamReq = new Request(upstream.toString(), {
    method: context.request.method,
    headers: stripHopByHop(context.request.headers),
    body:
      context.request.method === 'GET' || context.request.method === 'HEAD'
        ? undefined
        : context.request.body,
    redirect: 'manual',
  });

  const upstreamRes = await fetch(upstreamReq);

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers: upstreamRes.headers,
  });
};

function stripHopByHop(input: Headers): Headers {
  const out = new Headers(input);
  for (const h of [
    'host',
    'connection',
    'content-length',
    'transfer-encoding',
    'upgrade',
    'cf-connecting-ip',
    'cf-ipcountry',
    'cf-ray',
    'cf-visitor',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-real-ip',
  ]) {
    out.delete(h);
  }
  return out;
}
