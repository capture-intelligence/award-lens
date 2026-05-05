/**
 * Federal protests — GAO bid protest decisions. 11.6K rows per spec §4.
 * Source for full ingestion: GAO CADE scraper (deferred per "scrape-it-fake-it").
 * Demo dataset: ~200 seeded rows modeled on real GAO docket structure.
 */
import {
  pgTable, text, integer, boolean, jsonb, timestamp, index,
} from 'drizzle-orm/pg-core';
import { tsvector } from '../custom-types.js';

export const protests = pgTable(
  'protests',
  {
    protest_id:         text('protest_id').primaryKey(),
    slug:               text('slug').notNull(),
    gao_id:             text('gao_id').notNull(),
    gao_docket:         text('gao_docket'),
    protestor:          text('protestor').notNull(),
    protestor_awardee_id: text('protestor_awardee_id'),
    agency_id:          text('agency_id'),
    related_opportunity_id: text('related_opportunity_id'),
    solicitation_number: text('solicitation_number'),
    status:             text('status'),  // 'Open' | 'Dismissed' | 'Denied' | 'Sustained' | 'Withdrawn'
    case_type:          text('case_type'),  // 'Bid Protest' | 'Cost Claim'
    filed_at:           timestamp('filed_at', { withTimezone: true }),
    response_due_at:    timestamp('response_due_at', { withTimezone: true }),
    decided_at:         timestamp('decided_at', { withTimezone: true }),
    last_modified_at:   timestamp('last_modified_at', { withTimezone: true }),
    gao_attorney:       text('gao_attorney'),
    decision:           text('decision'),
    decision_url:       text('decision_url'),
    is_seeded:          boolean('is_seeded').notNull().default(true),
    search_vector:      tsvector('search_vector'),
    created_at:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_protest_status').on(t.status),
    index('idx_protest_agency').on(t.agency_id),
    index('idx_protest_opp').on(t.related_opportunity_id),
    index('idx_protest_protestor').on(t.protestor),
    index('idx_protest_filed').on(t.filed_at),
    index('idx_protest_search').using('gin', t.search_vector),
  ],
);
