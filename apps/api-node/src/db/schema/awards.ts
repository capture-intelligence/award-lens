/**
 * Award fact tables — split per spec §DB:
 *   contract_awards_idv     ~ 1M
 *   contract_awards_prime   ~ 81.1M (the heavy one)
 *   contract_awards_sub     ~ 1.6M
 *   grant_awards_prime      ~ 9.6M
 *   grant_awards_sub        ~ 7M
 *
 * For the $0 demo we ingest FY25 + value > $100K → ~500K prime + ~50K IDV.
 * The 81M number is the eventual target when budget unlocks.
 *
 * Naming: keep table singular for read ergonomics
 * (`db.select().from(contract_awards_idv)` looks fine).
 */
import {
  pgTable, text, integer, bigint, boolean, jsonb, timestamp, numeric, index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tsvector } from '../custom-types.js';

// ─── Contract awards: IDV (parent vehicles) ───────────────────────────────
export const contract_awards_idv = pgTable(
  'contract_awards_idv',
  {
    award_id:                  text('award_id').primaryKey(),
    award_piid:                text('award_piid'),
    parent_piid:               text('parent_piid'),
    awardee_id:                text('awardee_id'),
    awarding_agency_id:        text('awarding_agency_id'),
    funding_agency_id:         text('funding_agency_id'),
    awarding_office_id:        text('awarding_office_id'),
    funding_office_id:         text('funding_office_id'),
    naics:                     text('naics'),
    psc:                       text('psc'),
    description:               text('description'),
    pricing:                   text('pricing'),               // 'Fixed Price' | 'Cost Plus' | etc.
    set_aside:                 text('set_aside'),
    extent_competed:           text('extent_competed'),
    multiple_award:            boolean('multiple_award'),
    who_can_use:               text('who_can_use'),           // 'Single' | 'Multiple Agencies'
    individual_order_limit:    bigint('individual_order_limit', { mode: 'bigint' }),
    vehicle_ceiling:           bigint('vehicle_ceiling', { mode: 'bigint' }),
    vehicle_pct_used:          numeric('vehicle_pct_used'),
    related_opportunity_id:    text('related_opportunity_id'),
    base_value:                bigint('base_value', { mode: 'bigint' }),
    current_value:             bigint('current_value', { mode: 'bigint' }),
    potential_value:           bigint('potential_value', { mode: 'bigint' }),
    obligated_amount:          bigint('obligated_amount', { mode: 'bigint' }),
    funded_backlog:            bigint('funded_backlog', { mode: 'bigint' }),
    total_backlog:             bigint('total_backlog', { mode: 'bigint' }),
    pop_start_date:            timestamp('pop_start_date', { withTimezone: true }),
    pop_end_date:              timestamp('pop_end_date', { withTimezone: true }),
    progress_pct:              numeric('progress_pct'),
    pop_country:               text('pop_country'),
    pop_state:                 text('pop_state'),
    pop_city:                  text('pop_city'),
    pop_zip:                   text('pop_zip'),
    awardee_uei:               text('awardee_uei'),
    awardee_cage:              text('awardee_cage'),
    number_of_bidders:         integer('number_of_bidders'),
    solicitation_procedures:   text('solicitation_procedures'),
    commercial_item_acquisition: text('commercial_item_acquisition'),
    subcontracting_plan:       text('subcontracting_plan'),
    cost_accounting_standards: text('cost_accounting_standards'),
    business_size_determination: text('business_size_determination'),
    legislative_mandates:      jsonb('legislative_mandates').$type<string[]>(),
    awardee_district:          text('awardee_district'),
    source_last_modified:      timestamp('source_last_modified', { withTimezone: true }),
    raw_payload:               jsonb('raw_payload'),
    search_vector:             tsvector('search_vector'),
    created_at:                timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:                timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_idv_piid').on(t.award_piid),
    index('idx_idv_awardee').on(t.awardee_id),
    index('idx_idv_agency').on(t.awarding_agency_id),
    index('idx_idv_naics').on(t.naics),
    index('idx_idv_psc').on(t.psc),
    index('idx_idv_pop_end').on(t.pop_end_date),
    index('idx_idv_current_value').on(t.current_value),
    index('idx_idv_search').using('gin', t.search_vector),
  ],
);

// ─── Contract awards: prime contracts (task orders, standalone, against IDV) ──
export const contract_awards_prime = pgTable(
  'contract_awards_prime',
  {
    award_id:               text('award_id').primaryKey(),
    award_piid:             text('award_piid'),
    parent_idv_id:          text('parent_idv_id'),  // links into contract_awards_idv
    awardee_id:             text('awardee_id'),
    awarding_agency_id:     text('awarding_agency_id'),
    funding_agency_id:      text('funding_agency_id'),
    naics:                  text('naics'),
    psc:                    text('psc'),
    description:            text('description'),
    set_aside:              text('set_aside'),
    pricing:                text('pricing'),
    extent_competed:        text('extent_competed'),
    base_value:             bigint('base_value', { mode: 'bigint' }),
    current_value:          bigint('current_value', { mode: 'bigint' }),
    potential_value:        bigint('potential_value', { mode: 'bigint' }),
    obligated_amount:       bigint('obligated_amount', { mode: 'bigint' }),
    pop_start_date:         timestamp('pop_start_date', { withTimezone: true }),
    pop_end_date:           timestamp('pop_end_date', { withTimezone: true }),
    pop_state:              text('pop_state'),
    pop_country:            text('pop_country'),
    fiscal_year:            integer('fiscal_year'),
    related_opportunity_id: text('related_opportunity_id'),
    awardee_uei:            text('awardee_uei'),
    awardee_cage:           text('awardee_cage'),
    source_last_modified:   timestamp('source_last_modified', { withTimezone: true }),
    raw_payload:            jsonb('raw_payload'),
    search_vector:          tsvector('search_vector'),
    created_at:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:             timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_prime_awardee').on(t.awardee_id),
    index('idx_prime_agency').on(t.awarding_agency_id),
    index('idx_prime_idv').on(t.parent_idv_id),
    index('idx_prime_naics').on(t.naics),
    index('idx_prime_psc').on(t.psc),
    index('idx_prime_fy').on(t.fiscal_year),
    index('idx_prime_pop_end').on(t.pop_end_date),
    index('idx_prime_value').on(t.current_value),
    index('idx_prime_search').using('gin', t.search_vector),
  ],
);

// ─── Subcontracts ─────────────────────────────────────────────────────────
export const contract_awards_sub = pgTable(
  'contract_awards_sub',
  {
    subaward_id:           text('subaward_id').primaryKey(),
    parent_award_id:       text('parent_award_id'),  // → contract_awards_prime.award_id
    awardee_id:            text('awardee_id'),
    prime_awardee_id:      text('prime_awardee_id'),
    prime_awarding_agency_id: text('prime_awarding_agency_id'),
    description:           text('description'),
    obligated_amount:      bigint('obligated_amount', { mode: 'bigint' }),
    action_date:           timestamp('action_date', { withTimezone: true }),
    naics:                 text('naics'),
    psc:                   text('psc'),
    fiscal_year:           integer('fiscal_year'),
    raw_payload:           jsonb('raw_payload'),
    created_at:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:            timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_sub_awardee').on(t.awardee_id),
    index('idx_sub_prime').on(t.prime_awardee_id),
    index('idx_sub_parent').on(t.parent_award_id),
  ],
);

// ─── Grant awards: prime ──────────────────────────────────────────────────
export const grant_awards_prime = pgTable(
  'grant_awards_prime',
  {
    award_id:               text('award_id').primaryKey(),
    award_fain:             text('award_fain'),
    sai_number:             text('sai_number'),
    award_id_uri:           text('award_id_uri'),
    awardee_id:             text('awardee_id'),
    awarding_agency_id:     text('awarding_agency_id'),
    funding_agency_id:      text('funding_agency_id'),
    cfda_program:           text('cfda_program'),
    related_opportunity_id: text('related_opportunity_id'),
    grant_type:             text('grant_type'),  // 'Project' | 'Formula' | 'Cooperative Agreement' | etc.
    grant_description:      text('grant_description'),
    funding_goals:          text('funding_goals'),
    federal_obligation:     bigint('federal_obligation', { mode: 'bigint' }),
    non_federal_obligation: bigint('non_federal_obligation', { mode: 'bigint' }),
    total_obligated:        bigint('total_obligated', { mode: 'bigint' }),
    pop_start_date:         timestamp('pop_start_date', { withTimezone: true }),
    pop_end_date:           timestamp('pop_end_date', { withTimezone: true }),
    pop_state:              text('pop_state'),
    pop_city:               text('pop_city'),
    pop_zip:                text('pop_zip'),
    geographic_scope:       text('geographic_scope'),  // 'Single Zip Code' | 'State' | 'National' | etc.
    awardee_classifications: jsonb('awardee_classifications').$type<string[]>(),
    awardee_uei:            text('awardee_uei'),
    awardee_cage:           text('awardee_cage'),
    performance_district:   text('performance_district'),
    senators:               jsonb('senators').$type<string[]>(),
    fiscal_year:            integer('fiscal_year'),
    source_last_modified:   timestamp('source_last_modified', { withTimezone: true }),
    raw_payload:            jsonb('raw_payload'),
    search_vector:          tsvector('search_vector'),
    created_at:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:             timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_grant_prime_awardee').on(t.awardee_id),
    index('idx_grant_prime_agency').on(t.awarding_agency_id),
    index('idx_grant_prime_cfda').on(t.cfda_program),
    index('idx_grant_prime_fy').on(t.fiscal_year),
    index('idx_grant_prime_value').on(t.total_obligated),
    index('idx_grant_prime_search').using('gin', t.search_vector),
  ],
);

// ─── Grant awards: subgrants ──────────────────────────────────────────────
export const grant_awards_sub = pgTable(
  'grant_awards_sub',
  {
    subgrant_id:            text('subgrant_id').primaryKey(),
    parent_award_id:        text('parent_award_id'),
    awardee_id:             text('awardee_id'),
    prime_awardee_id:       text('prime_awardee_id'),
    obligated_amount:       bigint('obligated_amount', { mode: 'bigint' }),
    action_date:            timestamp('action_date', { withTimezone: true }),
    fiscal_year:            integer('fiscal_year'),
    raw_payload:            jsonb('raw_payload'),
    created_at:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:             timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_sgrant_awardee').on(t.awardee_id),
    index('idx_sgrant_prime').on(t.prime_awardee_id),
  ],
);

// ─── Award modifications history ──────────────────────────────────────────
export const award_modification = pgTable(
  'award_modification',
  {
    mod_id:           text('mod_id').primaryKey(),
    award_id:         text('award_id').notNull(),
    award_kind:       text('award_kind').notNull(),  // 'idv' | 'prime' | 'sub' | 'grant_prime' | 'grant_sub'
    mod_number:       text('mod_number'),
    action_date:      timestamp('action_date', { withTimezone: true }).notNull(),
    action_type:      text('action_type'),
    obligation_delta: bigint('obligation_delta', { mode: 'bigint' }),
    new_total_value:  bigint('new_total_value', { mode: 'bigint' }),
    reason_code:      text('reason_code'),
    description:      text('description'),
    source_id:        text('source_id'),
    source_tx_id:     text('source_tx_id'),
  },
  (t) => [
    index('idx_mod_award').on(t.award_id, t.action_date),
    uniqueIndex('uq_mod_source_tx').on(t.source_id, t.source_tx_id),
  ],
);

// ─── Suggested people on award detail (Tab 9 — People) ────────────────────
export const award_person = pgTable(
  'award_person',
  {
    award_id:    text('award_id').notNull(),
    person_id:   text('person_id').notNull(),
    award_kind:  text('award_kind').notNull(),
    role:        text('role'),
  },
  (t) => [
    index('idx_awardperson_award').on(t.award_id),
  ],
);
