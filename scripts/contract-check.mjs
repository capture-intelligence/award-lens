#!/usr/bin/env node
/**
 * Frontend↔API contract smoke-check.
 *
 * Why this exists: the dashboard once white-screened because the KPI strip
 * read `overview.total_opportunities` while the live /stats/overview returned
 * a different shape — a field the frontend depended on was simply absent, and
 * nothing caught it until a human saw a blank page. This script encodes, for
 * every endpoint the CaptureRadar web app consumes, the exact fields its TS
 * interfaces rely on, and fails loudly when the live API drifts from them.
 *
 * Two modes (auto-selected):
 *   • WITHOUT a session cookie — confirms every route is reachable and
 *     auth-gated (HTTP 401), i.e. the Pages proxy allowlist and worker route
 *     both exist. (A missing route returns the SPA's index.html / 404 — the
 *     "/pipeline not in proxy" class of bug — which this catches.)
 *   • WITH a session cookie (env SESSION_COOKIE) — additionally fetches a real
 *     record from each endpoint and asserts every contracted field is present
 *     and correctly typed.
 *
 * Usage:
 *   node scripts/contract-check.mjs
 *   BASE_URL=https://awards-dashboard.pages.dev \
 *     SESSION_COOKIE='awards_session=<value from browser devtools>' \
 *     node scripts/contract-check.mjs
 *
 * Exit codes: 0 = all contracts hold · 1 = a contract failed · 2 = could not run.
 */

const BASE_URL = (process.env.BASE_URL || 'https://awards-dashboard.pages.dev').replace(/\/$/, '');
const COOKIE = process.env.SESSION_COOKIE || '';
const AUTHED = COOKIE.length > 0;

// ─── Contracts ──────────────────────────────────────────────────────────────
// `fields` maps a field name to allowed types. "string|null" means the value
// may be null but must be PRESENT — a missing (undefined) field always fails,
// because that is exactly the defect that broke the dashboard.
const OBJ = 'object';
const contracts = [
  {
    name: 'stats/overview',
    path: '/stats/overview',
    shape: 'object',
    fields: { awards: 'number', vendors: 'number', organizations: 'number', total_obligated_usd: 'number' },
  },
  {
    name: 'pipeline/stats',
    path: '/pipeline/stats',
    shape: 'object',
    fields: { open_now: 'number', total_solicitations: 'number', summarized_attachments: 'number' },
  },
  {
    name: 'pipeline/solicitations',
    path: '/pipeline/solicitations?open_only=false&limit=1',
    shape: 'results',
    fields: {
      solicitation_id: 'string', notice_type: 'string', title: 'string',
      posted_date: 'string|null', response_deadline: 'string|null',
      agency: 'string|null', sub_agency: 'string|null', office: 'string|null',
      naics_codes: 'string|null', set_aside: 'string|null',
      days_to_deadline: 'number|null', summarized_count: 'number',
    },
    captureId: (row) => row.solicitation_id, // feeds the detail contract
  },
  {
    name: 'pipeline/solicitations/:id',
    path: (id) => `/pipeline/solicitations/${encodeURIComponent(id)}`,
    needsId: 'pipeline/solicitations',
    shape: 'object',
    nested: {
      solicitation: {
        solicitation_id: 'string', notice_type: 'string', title: 'string',
        posted_date: 'string|null', response_deadline: 'string|null',
        agency: 'string|null', naics_codes: 'string|null', set_aside: 'string|null',
        description: 'string|null', link: 'string|null',
      },
    },
    arrays: ['attachments'],
  },
  {
    name: 'vendors',
    path: '/vendors?limit=1',
    shape: 'results',
    fields: {
      vendor_id: 'string', uei: 'string|null', legal_name: 'string',
      num_awards: 'number', total_value: 'number',
      first_award_date: 'string|null', last_pop_end: 'string|null',
    },
    captureId: (row) => row.vendor_id,
  },
  {
    name: 'vendors/:id',
    path: (id) => `/vendors/${encodeURIComponent(id)}`,
    needsId: 'vendors',
    shape: 'object',
    nested: {
      vendor: {
        vendor_id: 'string', uei: 'string|null', legal_name: 'string',
        num_awards: 'number', total_value: 'number',
      },
    },
    arrays: ['classifications', 'top_awards'],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────
function typeOk(value, spec) {
  const allowed = spec.split('|');
  if (value === undefined) return false;              // missing field — never ok
  if (value === null) return allowed.includes('null');
  if (allowed.includes(OBJ) && typeof value === 'object') return true;
  return allowed.includes(typeof value);
}

function checkFields(sample, fields, prefix = '') {
  const problems = [];
  for (const [field, spec] of Object.entries(fields)) {
    if (!typeOk(sample?.[field], spec)) {
      const got = sample?.[field] === undefined ? 'MISSING' : `${JSON.stringify(sample?.[field])} (${typeof sample?.[field]})`;
      problems.push(`${prefix}${field}: expected ${spec}, got ${got}`);
    }
  }
  return problems;
}

async function fetchJson(path) {
  const res = await fetch(BASE_URL + path, {
    headers: COOKIE ? { cookie: COOKIE } : {},
    redirect: 'manual',
  });
  const ct = res.headers.get('content-type') || '';
  let body = null;
  if (ct.includes('application/json')) { try { body = await res.json(); } catch { /* ignore */ } }
  return { status: res.status, ct, body };
}

// ─── Run ──────────────────────────────────────────────────────────────────
const ids = {}; // captured sample ids by contract name
let failed = 0;
const lines = [];

console.log(`contract-check → ${BASE_URL}  (${AUTHED ? 'authenticated' : 'unauthenticated — routes-only'})\n`);

for (const c of contracts) {
  let path = c.path;
  if (typeof path === 'function') {
    const id = ids[c.needsId];
    if (!id) { lines.push(`SKIP  ${c.name} — no sample id from ${c.needsId}`); continue; }
    path = path(id);
  }

  let r;
  try { r = await fetchJson(path); }
  catch (e) { lines.push(`FAIL  ${c.name} — request error: ${e.message}`); failed++; continue; }

  // Route-existence check (always): a reachable, auth-gated route returns 401
  // when unauthenticated, or 2xx when authenticated. HTML / 404 means the
  // Pages proxy allowlist or the worker route is missing.
  if (!AUTHED) {
    if (r.status === 401) { lines.push(`ok    ${c.name} — 401 (route present, auth-gated)`); }
    else if (r.ct.includes('text/html')) { lines.push(`FAIL  ${c.name} — got HTML (proxy allowlist missing this prefix?)`); failed++; }
    else if (r.status === 404) { lines.push(`FAIL  ${c.name} — 404 (worker route missing)`); failed++; }
    else { lines.push(`warn  ${c.name} — unexpected ${r.status} unauthenticated`); }
    continue;
  }

  // Authenticated: validate the shape.
  if (r.status !== 200 || !r.body) { lines.push(`FAIL  ${c.name} — ${r.status} / ${r.ct} (expected 200 JSON)`); failed++; continue; }

  const problems = [];
  if (c.shape === 'object' && c.fields) problems.push(...checkFields(r.body, c.fields));
  if (c.shape === 'results') {
    const results = r.body.results;
    if (!Array.isArray(results)) problems.push(`results: expected array, got ${typeof results}`);
    else if (results.length > 0) problems.push(...checkFields(results[0], c.fields));
    else lines.push(`note  ${c.name} — results empty, field check skipped`);
    if (Array.isArray(results) && results.length && c.captureId) ids[c.name] = c.captureId(results[0]);
  }
  if (c.nested) for (const [key, fields] of Object.entries(c.nested)) {
    if (!r.body[key] || typeof r.body[key] !== 'object') problems.push(`${key}: expected object, got ${typeof r.body[key]}`);
    else problems.push(...checkFields(r.body[key], fields, `${key}.`));
  }
  if (c.arrays) for (const key of c.arrays) {
    if (!Array.isArray(r.body[key])) problems.push(`${key}: expected array, got ${typeof r.body[key]}`);
  }

  if (problems.length) { lines.push(`FAIL  ${c.name}\n        ${problems.join('\n        ')}`); failed++; }
  else lines.push(`ok    ${c.name} — shape matches`);
}

console.log(lines.join('\n'));
console.log('');

if (!AUTHED) {
  console.log('Routes-only mode. For full field validation, pass a session cookie:');
  console.log("  SESSION_COOKIE='awards_session=<value>' node scripts/contract-check.mjs");
  console.log('(Copy awards_session from your browser devtools → Application → Cookies.)\n');
}

if (failed > 0) { console.error(`✗ ${failed} contract(s) failed.`); process.exit(1); }
console.log('✓ all contracts hold.');
