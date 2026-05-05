/**
 * Stub list endpoints for entities Phase 1 scaffolds (data fills in once
 * ingestion runs). Each returns empty items + zero count + null next_cursor
 * so the frontend's TanStack Query setup, EmptyState component, and
 * TanStack Table all wire end-to-end before real data exists.
 */
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  awardees, agencies, people, contract_vehicles, documents, protests,
  defense_programs, it_programs, grant_programs_cfda, nia_codes, nsn_items,
  sewp_catalog, dod_budget, labor_pricing, news_articles,
  contract_awards_idv, contract_awards_prime, contract_awards_sub,
  grant_awards_prime, grant_awards_sub,
  ma_transactions, investors, advisors,
} from '../db/schema/index.js';
import { authMiddleware, requireApproved, type AuthVars } from '../auth/session.js';

export const stubRoutes = new Hono<{ Variables: AuthVars }>();
stubRoutes.use('*', authMiddleware);

type AnyTable = Parameters<typeof db.select>[0] extends never ? never : Parameters<typeof db.$count>[0];

async function countAndList(table: any, limit = 20) {
  // Hono validators on each route would be ideal — Phase 2 deepens the schema
  // (see opportunities.ts for the prod-shaped pattern). For Phase 1 this just
  // proves the endpoint shape and returns whatever's seeded.
  const items = await db.select().from(table).limit(limit);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(table);
  return { items, total_count: count, next_cursor: null };
}

stubRoutes.get('/awardees',           requireApproved, async (c) => c.json(await countAndList(awardees)));
stubRoutes.get('/agencies',           requireApproved, async (c) => c.json(await countAndList(agencies)));
stubRoutes.get('/people',             requireApproved, async (c) => c.json(await countAndList(people)));
stubRoutes.get('/vehicles',           requireApproved, async (c) => c.json(await countAndList(contract_vehicles)));
stubRoutes.get('/documents',          requireApproved, async (c) => c.json(await countAndList(documents)));
stubRoutes.get('/protests',           requireApproved, async (c) => c.json(await countAndList(protests)));

stubRoutes.get('/defense-programs',   requireApproved, async (c) => c.json(await countAndList(defense_programs)));
stubRoutes.get('/it-programs',        requireApproved, async (c) => c.json(await countAndList(it_programs)));
stubRoutes.get('/cfda',               requireApproved, async (c) => c.json(await countAndList(grant_programs_cfda)));
stubRoutes.get('/nia',                requireApproved, async (c) => c.json(await countAndList(nia_codes)));
stubRoutes.get('/nsn',                requireApproved, async (c) => c.json(await countAndList(nsn_items)));
stubRoutes.get('/sewp',               requireApproved, async (c) => c.json(await countAndList(sewp_catalog)));
stubRoutes.get('/dod-budget',         requireApproved, async (c) => c.json(await countAndList(dod_budget)));

stubRoutes.get('/labor-pricing',      requireApproved, async (c) => c.json(await countAndList(labor_pricing)));
stubRoutes.get('/news',               requireApproved, async (c) => c.json(await countAndList(news_articles)));

stubRoutes.get('/awards/idv',         requireApproved, async (c) => c.json(await countAndList(contract_awards_idv)));
stubRoutes.get('/awards/prime',       requireApproved, async (c) => c.json(await countAndList(contract_awards_prime)));
stubRoutes.get('/awards/sub',         requireApproved, async (c) => c.json(await countAndList(contract_awards_sub)));
stubRoutes.get('/grant-awards/prime', requireApproved, async (c) => c.json(await countAndList(grant_awards_prime)));
stubRoutes.get('/grant-awards/sub',   requireApproved, async (c) => c.json(await countAndList(grant_awards_sub)));

// Capital Markets — Leader-tier paywalled at the auth layer (added in Phase 2)
stubRoutes.get('/m-and-a',            requireApproved, async (c) => c.json(await countAndList(ma_transactions)));
stubRoutes.get('/investors',          requireApproved, async (c) => c.json(await countAndList(investors)));
stubRoutes.get('/advisors',           requireApproved, async (c) => c.json(await countAndList(advisors)));
