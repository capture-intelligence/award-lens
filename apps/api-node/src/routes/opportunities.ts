/**
 * Contract + Grant Opportunities — list + detail endpoints.
 *
 * Phase 1 stubs — TanStack-Table-friendly cursor pagination, basic filter
 * shape, total_count. Real data lands once ingestion runs.
 *
 *   GET  /opportunities/contract        list + filters
 *   GET  /opportunities/contract/:slug  detail (15 tabs)
 *   GET  /opportunities/grant           list + filters
 *   GET  /opportunities/grant/:slug     detail (13 tabs)
 *   GET  /opportunities/forecasts       list
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, gte, ilike, lte, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { contract_opportunities, grant_opportunities, forecasts } from '../db/schema/index.js';
import { authMiddleware, requireApproved, type AuthVars } from '../auth/session.js';

export const oppRoutes = new Hono<{ Variables: AuthVars }>();
oppRoutes.use('*', authMiddleware);

// ─── Filter schema (shared between contract + grant lists) ─────────────────
const listQuery = z.object({
  q:           z.string().optional(),
  agency:      z.string().optional(),
  naics:       z.string().optional(),
  psc:         z.string().optional(),
  set_aside:   z.string().optional(),
  scope:       z.enum(['federal', 'sled']).optional(),
  state:       z.string().length(2).optional(),
  posted_from: z.string().datetime().optional(),
  posted_to:   z.string().datetime().optional(),
  due_from:    z.string().datetime().optional(),
  due_to:      z.string().datetime().optional(),
  active_only: z.coerce.boolean().default(true),
  exclude_sole_source: z.coerce.boolean().default(false),
  cursor:      z.string().optional(),  // base64-encoded posted_at|id
  limit:       z.coerce.number().int().min(1).max(100).default(20),
  sort:        z.enum(['posted_desc', 'deadline_asc', 'value_desc']).default('posted_desc'),
});

// ─── Federal Contract Opportunities — list ─────────────────────────────────
oppRoutes.get(
  '/contract',
  requireApproved,
  zValidator('query', listQuery),
  async (c) => {
    const q = c.req.valid('query');

    const where = [];
    if (q.active_only) where.push(eq(contract_opportunities.is_active, true));
    if (q.scope) where.push(eq(contract_opportunities.scope, q.scope));
    if (q.state) where.push(eq(contract_opportunities.state_code, q.state));
    if (q.agency) where.push(eq(contract_opportunities.agency_id, q.agency));
    if (q.naics) where.push(eq(contract_opportunities.naics, q.naics));
    if (q.psc) where.push(eq(contract_opportunities.psc, q.psc));
    if (q.set_aside) where.push(eq(contract_opportunities.set_aside, q.set_aside));
    if (q.posted_from) where.push(gte(contract_opportunities.posted_at, new Date(q.posted_from)));
    if (q.posted_to) where.push(lte(contract_opportunities.posted_at, new Date(q.posted_to)));
    if (q.due_from) where.push(gte(contract_opportunities.response_deadline, new Date(q.due_from)));
    if (q.due_to) where.push(lte(contract_opportunities.response_deadline, new Date(q.due_to)));
    if (q.exclude_sole_source) where.push(eq(contract_opportunities.is_sole_source, false));
    if (q.q) {
      // pg_trgm fuzzy match on title; full FTS rolls in once we generate
      // the search_vector column from a migration trigger.
      where.push(ilike(contract_opportunities.title, `%${q.q}%`));
    }

    const whereExpr = where.length ? and(...where) : undefined;

    const rows = await db
      .select({
        opportunity_id:   contract_opportunities.opportunity_id,
        slug:             contract_opportunities.slug,
        title:            contract_opportunities.title,
        type:             contract_opportunities.type,
        agency_id:        contract_opportunities.agency_id,
        set_aside:        contract_opportunities.set_aside,
        naics:            contract_opportunities.naics,
        psc:              contract_opportunities.psc,
        posted_at:        contract_opportunities.posted_at,
        response_deadline:contract_opportunities.response_deadline,
        is_active:        contract_opportunities.is_active,
        ai_value_min:     contract_opportunities.ai_value_min,
        ai_value_max:     contract_opportunities.ai_value_max,
        description_summary: contract_opportunities.description_summary,
      })
      .from(contract_opportunities)
      .where(whereExpr)
      .orderBy(desc(contract_opportunities.posted_at))
      .limit(q.limit + 1);

    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    const lastItem = items[items.length - 1];
    const nextCursor =
      hasMore && lastItem?.posted_at
        ? Buffer.from(`${lastItem.posted_at.toISOString()}|${lastItem.opportunity_id}`).toString('base64url')
        : null;

    // Cheap count (replace with cached aggregate later)
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(contract_opportunities)
      .where(whereExpr);

    return c.json({ items, total_count: count, next_cursor: nextCursor });
  },
);

// ─── Federal Contract Opportunity — detail (15 tabs) ───────────────────────
oppRoutes.get('/contract/:slug', requireApproved, async (c) => {
  const slug = c.req.param('slug');
  const [opp] = await db
    .select()
    .from(contract_opportunities)
    .where(eq(contract_opportunities.slug, slug))
    .limit(1);
  if (!opp) return c.json({ error: 'not_found' }, 404);
  // Tab-specific data (bidders, similar, incumbents, etc.) is lazy-loaded
  // by the SPA — return the core record here only.
  return c.json({ opportunity: opp });
});

// ─── Grant Opportunities — list ────────────────────────────────────────────
oppRoutes.get(
  '/grant',
  requireApproved,
  zValidator('query', listQuery),
  async (c) => {
    const q = c.req.valid('query');
    const where = [];
    if (q.active_only) where.push(eq(grant_opportunities.is_active, true));
    if (q.agency) where.push(eq(grant_opportunities.agency_id, q.agency));
    if (q.q) where.push(ilike(grant_opportunities.title, `%${q.q}%`));

    const whereExpr = where.length ? and(...where) : undefined;

    const rows = await db
      .select()
      .from(grant_opportunities)
      .where(whereExpr)
      .orderBy(desc(grant_opportunities.posted_at))
      .limit(q.limit);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(grant_opportunities)
      .where(whereExpr);

    return c.json({ items: rows, total_count: count, next_cursor: null });
  },
);

oppRoutes.get('/grant/:slug', requireApproved, async (c) => {
  const slug = c.req.param('slug');
  const [opp] = await db
    .select()
    .from(grant_opportunities)
    .where(eq(grant_opportunities.slug, slug))
    .limit(1);
  if (!opp) return c.json({ error: 'not_found' }, 404);
  return c.json({ opportunity: opp });
});

// ─── Forecasts ─────────────────────────────────────────────────────────────
oppRoutes.get('/forecasts', requireApproved, async (c) => {
  const rows = await db
    .select()
    .from(forecasts)
    .orderBy(desc(forecasts.posted_at))
    .limit(20);
  return c.json({ items: rows });
});
