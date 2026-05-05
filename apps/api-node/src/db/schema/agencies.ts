/**
 * Agencies — federal awarding/funding organizations with full hierarchy.
 * 3K rows per spec §4. Self-referential parent_id supports the deep nesting
 * (DoD → USA → AMC → ACC) the audit observed.
 */
import {
  pgTable, text, integer, boolean, jsonb, timestamp, index,
} from 'drizzle-orm/pg-core';
import { tsvector } from '../custom-types.js';

export const agencies = pgTable(
  'agencies',
  {
    agency_id:                  text('agency_id').primaryKey(),
    parent_agency_id:           text('parent_agency_id'),
    slug:                       text('slug').notNull(),
    name:                       text('name').notNull(),
    short_name:                 text('short_name'),
    acronym:                    text('acronym'),
    agency_type:                text('agency_type'),  // 'Defense Agency' | 'Civilian Agency' | 'Sub-Agency' | 'Office'
    description:                text('description'),
    website:                    text('website'),
    logo_url:                   text('logo_url'),
    budget_justification_url:   text('budget_justification_url'),
    prime_contract_set_aside_goal_pct: text('prime_contract_set_aside_goal_pct'),
    set_aside_goal_fy:          integer('set_aside_goal_fy'),
    is_dod:                     boolean('is_dod').notNull().default(false),
    is_civilian:                boolean('is_civilian').notNull().default(true),
    toptier_code:               text('toptier_code'),  // FPDS 3-digit
    fpds_org_code:              text('fpds_org_code'),
    external_ids:               jsonb('external_ids'),
    is_stub:                    boolean('is_stub').notNull().default(false),
    py_obligated:               text('py_obligated'),
    py_award_count:             integer('py_award_count'),
    search_vector:              tsvector('search_vector'),  // generated col, populated in migration
    created_at:                 timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:                 timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_agency_slug').on(t.slug),
    index('idx_agency_parent').on(t.parent_agency_id),
    index('idx_agency_type').on(t.agency_type),
    index('idx_agency_toptier').on(t.toptier_code),
    index('idx_agency_search').using('gin', t.search_vector),
    index('idx_agency_name_trgm').using('gin', t.name),  // pg_trgm for fuzzy match
  ],
);

// Aliases / former names — supports reconciliation matching by alias.
export const agency_alias = pgTable(
  'agency_alias',
  {
    alias_id:    integer('alias_id').generatedAlwaysAsIdentity().primaryKey(),
    agency_id:   text('agency_id').notNull().references(() => agencies.agency_id, { onDelete: 'cascade' }),
    alias:       text('alias').notNull(),
    alias_type:  text('alias_type'),  // 'former_name' | 'short_name' | 'fpds_match'
  },
  (t) => [
    index('idx_alias_agency').on(t.agency_id),
    index('idx_alias_text_trgm').using('gin', t.alias),
  ],
);

// Contracting offices (sub-agency level)
export const contracting_office = pgTable(
  'contracting_office',
  {
    office_id:        text('office_id').primaryKey(),
    agency_id:        text('agency_id').references(() => agencies.agency_id),
    fpds_office_code: text('fpds_office_code'),
    name:             text('name').notNull(),
    city:             text('city'),
    state:            text('state'),
    is_active:        boolean('is_active').notNull().default(true),
  },
  (t) => [
    index('idx_office_agency').on(t.agency_id),
    index('idx_office_fpds').on(t.fpds_office_code),
  ],
);
