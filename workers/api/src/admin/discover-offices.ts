/**
 * Office discovery — sample USAspending using a view's keywords + subtier,
 * tally awarding offices observed, return top N for admin review.
 *
 *   POST /admin/views/:id/discover-offices
 *   body: { sample_pages?: number = 2 }   // 1 page = 100 awards
 *   resp: { offices: Array<{
 *     code: string | null;
 *     name: string;
 *     award_count: number;
 *     total_value: number;
 *     sample_piids: string[];
 *   }>, sampled: number }
 *
 * Read-only. Does not mutate the view; admin promotes the chosen office(s)
 * via PUT /admin/views/:id { filters: { office_names: [...] } } afterwards.
 */

import { Hono } from 'hono';
import { requireAdmin, type AuthVars } from '../auth/session.js';
import { deserializeFilters } from '../views/filters.js';

const USA_BASE = 'https://api.usaspending.gov/api/v2';
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

interface Env {
  DB: D1Database;
}
type Ctx = { Bindings: Env; Variables: AuthVars };

export const adminDiscoverOfficesApp = new Hono<Ctx>();
adminDiscoverOfficesApp.use('*', requireAdmin);

adminDiscoverOfficesApp.post('/:id/discover-offices', async (c) => {
  const viewId = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as { sample_pages?: number };
  const samplePages = Math.min(MAX_PAGES, Math.max(1, Number(body.sample_pages) || 2));

  const v = await c.env.DB.prepare('SELECT filters_json FROM data_view WHERE view_id = ?')
    .bind(viewId).first<{ filters_json: string }>();
  if (!v) return c.json({ error: 'not_found' }, 404);

  const f = deserializeFilters(v.filters_json);

  // The discovery filter intentionally ignores `office_names` (otherwise we'd
  // just confirm what's already configured). Keywords + subtier give the
  // recall surface admins are trying to characterize.
  const filterBlock: Record<string, unknown> = {
    time_period: [{
      // 24-month action_date window — wide enough to find recent offices.
      start_date: monthsAgo(24),
      end_date: monthsAgo(0),
      date_type: 'action_date',
    }],
    award_type_codes: f.award_types?.length ? f.award_types : ['A', 'B', 'C', 'D'],
  };
  const agencies: Array<{ type: string; tier: string; name: string }> = [];
  if (f.toptier_agency_name) agencies.push({ type: 'awarding', tier: 'toptier', name: f.toptier_agency_name });
  if (f.subtier_agency_name) agencies.push({ type: 'awarding', tier: 'subtier', name: f.subtier_agency_name });
  if (agencies.length) filterBlock.agencies = agencies;
  if (f.keywords?.length) filterBlock.keywords = f.keywords;
  if (f.naics_codes?.length) filterBlock.naics_codes = f.naics_codes;
  if (f.psc_codes?.length) filterBlock.psc_codes = f.psc_codes;

  type Tally = { code: string | null; name: string; award_count: number; total_value: number; sample_piids: string[] };
  const buckets = new Map<string, Tally>();
  let sampled = 0;

  for (let page = 1; page <= samplePages; page++) {
    const res = await fetch(`${USA_BASE}/search/spending_by_award/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        filters: filterBlock,
        fields: [
          'Award ID', 'Award Amount',
          'Awarding Office Code', 'Awarding Office Name',
        ],
        sort: 'Last Modified Date',
        order: 'desc',
        limit: PAGE_SIZE,
        page,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      const text = await res.text();
      return c.json({ error: 'usaspending_error', detail: `${res.status}: ${text.slice(0, 300)}` }, 502);
    }
    const data = await res.json() as {
      results?: Array<{
        'Award ID'?: string | null;
        'Award Amount'?: number | null;
        'Awarding Office Code'?: string | null;
        'Awarding Office Name'?: string | null;
      }>;
      page_metadata?: { hasNext?: boolean };
    };
    const rows = data.results ?? [];
    sampled += rows.length;

    for (const r of rows) {
      const code = r['Awarding Office Code'] ?? null;
      const name = r['Awarding Office Name'] ?? '(unknown office)';
      const key = code ?? `name:${name.toLowerCase()}`;
      const piid = r['Award ID'] ?? '';
      const amount = r['Award Amount'] ?? 0;
      const t = buckets.get(key);
      if (t) {
        t.award_count++;
        t.total_value += amount;
        if (t.sample_piids.length < 3 && piid && !t.sample_piids.includes(piid)) {
          t.sample_piids.push(piid);
        }
      } else {
        buckets.set(key, {
          code, name,
          award_count: 1,
          total_value: amount,
          sample_piids: piid ? [piid] : [],
        });
      }
    }
    if (!data.page_metadata?.hasNext) break;
  }

  const offices = Array.from(buckets.values())
    .sort((a, b) => b.award_count - a.award_count);

  return c.json({ sampled, offices });
});

function monthsAgo(n: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}
