/**
 * Pages Functions middleware — proxies API + auth paths to the worker so the
 * session cookie ends up first-party on the dashboard's origin.
 *
 * Why: Edge Tracking Prevention, Safari ITP, and Chrome's third-party cookie
 * phase-out silently drop cookies set on api-worker.algocrat.workers.dev when
 * the user is viewing awards-dashboard.pages.dev. Routing the API through
 * this same origin makes the cookie first-party.
 *
 * Static assets and the SPA HTML are not touched — only the listed API
 * prefixes are forwarded. Anything else falls through to Pages' static asset
 * pipeline via context.next().
 */

const API_PREFIXES = [
  '/auth',
  '/admin',
  '/awards',
  '/vendors',
  '/organizations',
  '/runs',
  '/stats',
  '/exclusions',
  '/opportunities',
  '/reconciliation',
  '/schedule',
  '/sam-api',
  '/import',
  '/diag',
  '/health',
  '/views',
] as const;

const WORKER_ORIGIN = 'https://api-worker.algocrat.workers.dev';

function shouldProxy(pathname: string): boolean {
  return API_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );
}

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);

  if (!shouldProxy(url.pathname)) {
    return context.next();
  }

  // Build the upstream URL: same path + same query string, swapped origin.
  const upstream = new URL(url.pathname + url.search, WORKER_ORIGIN);

  // Clone the incoming request, but rewrite the URL. We must NOT forward the
  // browser's Host header (it would say awards-dashboard.pages.dev) — fetch()
  // sets the right Host automatically when given a fresh URL.
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

  // Pass the response through verbatim — including any Set-Cookie headers,
  // which the browser will now treat as first-party for awards-dashboard.pages.dev.
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers: upstreamRes.headers,
  });
};

/**
 * Strip headers that should not be forwarded across a proxy hop.
 * Keep the Cookie header (browser session) and Authorization (Bearer ingest).
 */
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
