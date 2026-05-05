/**
 * Capital Markets — M&A transactions, investors, M&A advisors.
 * Spec §3.9 — paywalled to Leader tier; metered access for lower tiers
 * (differentiation from HigherGov's opaque "free views" model).
 *
 * Volumes per spec §4:
 *   ma_transactions: 8.2K (demo: ~50 real recent deals)
 *   investors:       165 (demo: ~30 known GovCon PE firms)
 *   advisors:        54  (demo: ~15 known M&A advisors)
 */
import {
  pgTable, text, integer, bigint, boolean, jsonb, timestamp, numeric, index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tsvector } from '../custom-types.js';

// ─── Investors (PE / VC firms in GovCon) ──────────────────────────────────
export const investors = pgTable(
  'investors',
  {
    investor_id:   text('investor_id').primaryKey(),
    slug:          text('slug').notNull(),
    name:          text('name').notNull(),
    website:       text('website'),
    fund_size:     bigint('fund_size', { mode: 'bigint' }),  // cents
    fund_year:     integer('fund_year'),
    headquarters:  text('headquarters'),
    description:   text('description'),
    is_seeded:     boolean('is_seeded').notNull().default(true),
    search_vector: tsvector('search_vector'),
  },
  (t) => [
    uniqueIndex('uq_investor_slug').on(t.slug),
    index('idx_investor_search').using('gin', t.search_vector),
  ],
);

// ─── Advisors (investment banks / law firms in GovCon M&A) ────────────────
export const advisors = pgTable(
  'advisors',
  {
    advisor_id:    text('advisor_id').primaryKey(),
    slug:          text('slug').notNull(),
    name:          text('name').notNull(),
    website:       text('website'),
    advisor_type:  text('advisor_type'),  // 'Investment Bank' | 'Law Firm' | 'Boutique'
    headquarters:  text('headquarters'),
    description:   text('description'),
    is_seeded:     boolean('is_seeded').notNull().default(true),
    search_vector: tsvector('search_vector'),
  },
  (t) => [
    uniqueIndex('uq_advisor_slug').on(t.slug),
    index('idx_advisor_search').using('gin', t.search_vector),
  ],
);

// ─── M&A transactions ─────────────────────────────────────────────────────
export const ma_transactions = pgTable(
  'ma_transactions',
  {
    transaction_id:   text('transaction_id').primaryKey(),
    announced_at:     timestamp('announced_at', { withTimezone: true }),
    closed_at:        timestamp('closed_at', { withTimezone: true }),
    status:           text('status'),  // 'Announced' | 'Closed' | 'Terminated'
    target_awardee_id: text('target_awardee_id'),
    target_name:      text('target_name'),
    buyer_awardee_id: text('buyer_awardee_id'),
    buyer_investor_id: text('buyer_investor_id'),
    buyer_name:       text('buyer_name'),
    buyer_type:       text('buyer_type'),  // 'Strategic' | 'PE' | 'Family Office'
    advisor_ids:      jsonb('advisor_ids').$type<string[]>(),
    investor_ids:     jsonb('investor_ids').$type<string[]>(),
    tev_cents:        bigint('tev_cents', { mode: 'bigint' }),  // total enterprise value
    revenue_multiple: numeric('revenue_multiple'),
    ebitda_multiple:  numeric('ebitda_multiple'),
    employee_count:   integer('employee_count'),
    target_obligations: bigint('target_obligations', { mode: 'bigint' }),
    is_divestiture:   boolean('is_divestiture').notNull().default(false),
    description:      text('description'),
    is_seeded:        boolean('is_seeded').notNull().default(true),
    search_vector:    tsvector('search_vector'),
    created_at:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_ma_status').on(t.status),
    index('idx_ma_target').on(t.target_awardee_id),
    index('idx_ma_buyer').on(t.buyer_awardee_id),
    index('idx_ma_investor').on(t.buyer_investor_id),
    index('idx_ma_announced').on(t.announced_at),
    index('idx_ma_search').using('gin', t.search_vector),
  ],
);
