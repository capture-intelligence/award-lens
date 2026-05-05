/**
 * Programs — Defense programs, IT programs, Grant programs (CFDA / Assistance
 * Listings).
 *
 * Volumes per spec §4:
 *   defense_programs:    242
 *   it_programs:         7.5K
 *   grant_programs_cfda: 6.9K
 */
import {
  pgTable, text, integer, bigint, boolean, jsonb, timestamp, index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tsvector } from '../custom-types.js';

// ─── Defense programs (F-35, ABRAMS, etc.) ────────────────────────────────
export const defense_programs = pgTable(
  'defense_programs',
  {
    program_id:         text('program_id').primaryKey(),
    slug:               text('slug').notNull(),
    name:               text('name').notNull(),
    dod_code:           text('dod_code'),
    primary_agency_id:  text('primary_agency_id'),
    description:        text('description'),
    contracts_total:    text('contracts_total'),
    subcontracts_total: text('subcontracts_total'),
    grand_total:        text('grand_total'),
    py_award_count:     integer('py_award_count'),
    is_seeded:          boolean('is_seeded').notNull().default(false),
    search_vector:      tsvector('search_vector'),
  },
  (t) => [
    uniqueIndex('uq_defprog_slug').on(t.slug),
    index('idx_defprog_agency').on(t.primary_agency_id),
    index('idx_defprog_search').using('gin', t.search_vector),
  ],
);

// ─── IT Programs (federal IT investments / IT Dashboard) ──────────────────
export const it_programs = pgTable(
  'it_programs',
  {
    program_id:           text('program_id').primaryKey(),
    slug:                 text('slug').notNull(),
    name:                 text('name').notNull(),
    investment_id:        text('investment_id'),
    agency_id:            text('agency_id'),
    program_type:         text('program_type'),
    multi_agency_category:text('multi_agency_category'),
    description:          text('description'),
    fy23_funding:         bigint('fy23_funding', { mode: 'bigint' }),
    budget_history:       jsonb('budget_history'),
    search_vector:        tsvector('search_vector'),
  },
  (t) => [
    uniqueIndex('uq_itprog_slug').on(t.slug),
    index('idx_itprog_agency').on(t.agency_id),
    index('idx_itprog_search').using('gin', t.search_vector),
  ],
);

// ─── Grant programs / CFDA / Assistance Listings ──────────────────────────
export const grant_programs_cfda = pgTable(
  'grant_programs_cfda',
  {
    cfda_number:         text('cfda_number').primaryKey(),
    slug:                text('slug').notNull(),
    title:               text('title').notNull(),
    popular_title:       text('popular_title'),
    agency_id:           text('agency_id'),
    is_active:           boolean('is_active').notNull().default(true),
    objective:           text('objective'),
    type_of_assistance:  text('type_of_assistance'),  // 'A - Formula Grants' etc.
    applicant_eligibility: text('applicant_eligibility'),
    beneficiary_eligibility: text('beneficiary_eligibility'),
    last_modified_at:    timestamp('last_modified_at', { withTimezone: true }),
    posted_at:           timestamp('posted_at', { withTimezone: true }),
    py_award_total:      text('py_award_total'),
    py_award_count:      integer('py_award_count'),
    search_vector:       tsvector('search_vector'),
  },
  (t) => [
    uniqueIndex('uq_cfda_slug').on(t.slug),
    index('idx_cfda_agency').on(t.agency_id),
    index('idx_cfda_active').on(t.is_active),
    index('idx_cfda_search').using('gin', t.search_vector),
  ],
);
