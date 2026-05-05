/**
 * Contract vehicles — IDIQ, GWAC, GSA Schedule, BPA, MAS. 6.1K rows per spec §4.
 * Sits between IDV awards and prime awards in the hierarchy:
 *   vehicle → IDVs → prime contracts → subcontracts.
 */
import {
  pgTable, text, integer, bigint, boolean, jsonb, timestamp, numeric, index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tsvector } from '../custom-types.js';

export const contract_vehicles = pgTable(
  'contract_vehicles',
  {
    vehicle_id:           text('vehicle_id').primaryKey(),
    slug:                 text('slug').notNull(),
    name:                 text('name').notNull(),
    vehicle_type:         text('vehicle_type'),  // 'GSA Schedule' | 'GWAC' | 'IDIQ' | 'BPA' | etc.
    primary_agency_id:    text('primary_agency_id'),
    sponsoring_agency_id: text('sponsoring_agency_id'),
    who_can_use:          text('who_can_use'),  // 'Single Agency' | 'Multiple Agencies'
    primary_naics:        text('primary_naics'),
    primary_psc:          text('primary_psc'),
    primary_set_aside:    text('primary_set_aside'),
    extent_competed:      text('extent_competed'),
    related_opportunity_id: text('related_opportunity_id'),
    subcategories:        jsonb('subcategories').$type<string[]>(),

    // Funding tab (spec §3.3 Vehicle Detail Tab 4)
    ceiling:              bigint('ceiling', { mode: 'bigint' }),
    total_obligated:      bigint('total_obligated', { mode: 'bigint' }),
    current_award:        bigint('current_award', { mode: 'bigint' }),
    potential_award:      bigint('potential_award', { mode: 'bigint' }),
    funded_backlog:       bigint('funded_backlog', { mode: 'bigint' }),
    total_backlog:        bigint('total_backlog', { mode: 'bigint' }),
    progress_pct:         numeric('progress_pct'),

    award_date:           timestamp('award_date', { withTimezone: true }),
    final_date:           timestamp('final_date', { withTimezone: true }),
    py_award_total:       text('py_award_total'),
    py_award_count:       integer('py_award_count'),
    awardees_count:       integer('awardees_count').notNull().default(0),
    contracts_count:      integer('contracts_count').notNull().default(0),
    subcontracts_count:   integer('subcontracts_count').notNull().default(0),

    description:          text('description'),
    is_active:            boolean('is_active').notNull().default(true),
    search_vector:        tsvector('search_vector'),
    created_at:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:           timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_vehicle_slug').on(t.slug),
    index('idx_vehicle_type').on(t.vehicle_type),
    index('idx_vehicle_agency').on(t.primary_agency_id),
    index('idx_vehicle_naics').on(t.primary_naics),
    index('idx_vehicle_active').on(t.is_active),
    index('idx_vehicle_search').using('gin', t.search_vector),
  ],
);

// Awardee → Vehicle membership (Schedules tab on awardee, Awardees tab on vehicle)
export const vehicle_awardee = pgTable(
  'vehicle_awardee',
  {
    vehicle_id:        text('vehicle_id').notNull(),
    awardee_id:        text('awardee_id').notNull(),
    award_id:          text('award_id'),     // optional link to IDV
    pop_start_date:    timestamp('pop_start_date', { withTimezone: true }),
    pop_end_date:      timestamp('pop_end_date', { withTimezone: true }),
    type:              text('type'),
    obligated:         bigint('obligated', { mode: 'bigint' }),
    last_modified:     timestamp('last_modified', { withTimezone: true }),
    obligation_pct:    numeric('obligation_pct'),  // share of vehicle (radar chart)
  },
  (t) => [
    uniqueIndex('uq_vehicle_awardee_pair').on(t.vehicle_id, t.awardee_id),
    index('idx_va_vehicle').on(t.vehicle_id),
    index('idx_va_awardee').on(t.awardee_id),
  ],
);
