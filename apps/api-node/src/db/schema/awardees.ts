/**
 * Awardees — federal contractors and grantees. 2.2M target rows per spec §4.
 * Includes the "claim" + "customize awardee profile" features (capability
 * statement, teaming goals, highlight profile).
 */
import {
  pgTable, text, integer, boolean, jsonb, timestamp, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tsvector, vector } from '../custom-types.js';

export const awardees = pgTable(
  'awardees',
  {
    awardee_id:           text('awardee_id').primaryKey(),
    parent_awardee_id:    text('parent_awardee_id'),  // self-FK; large parents have many children
    slug:                 text('slug').notNull(),
    legal_name:           text('legal_name').notNull(),
    common_name:          text('common_name'),
    dba_name:             text('dba_name'),
    alternative_names:    jsonb('alternative_names').$type<string[]>(),
    awardee_type:         text('awardee_type'),  // 'Parent' | 'Child'
    company_description:  text('company_description'),
    keywords:             jsonb('keywords').$type<string[]>(),
    website:              text('website'),
    ownership:            text('ownership'),  // 'Publicly Traded:NYSE:LMT' | 'Private' | etc.
    ticker_exchange:      text('ticker_exchange'),
    ticker_symbol:        text('ticker_symbol'),
    entity_structure:     text('entity_structure'),  // 'Corporate' | 'Partnership' | 'LLC' | 'Sole Proprietor'
    founded:              integer('founded'),

    // Federal registration
    uei:                  text('uei'),
    cage_code:            text('cage_code'),
    duns:                 text('duns'),

    // Headquarters
    hq_country:           text('hq_country'),
    hq_state:             text('hq_state'),
    hq_city:              text('hq_city'),
    hq_zip:               text('hq_zip'),
    hq_address:           text('hq_address'),

    primary_naics:        text('primary_naics'),

    // SBA + self certifications stored as arrays
    sba_certifications:   jsonb('sba_certifications').$type<string[]>(),
    self_certifications:  jsonb('self_certifications').$type<string[]>(),

    // Aggregate KPIs (denormalized; refreshed by nightly job)
    total_py_awards:           text('total_py_awards'),  // bigint as text
    contracts_count:           integer('contracts_count').notNull().default(0),
    contracts_obligated:       text('contracts_obligated'),
    subcontracts_count:        integer('subcontracts_count').notNull().default(0),
    subcontracts_obligated:    text('subcontracts_obligated'),
    grants_count:              integer('grants_count').notNull().default(0),
    grants_obligated:          text('grants_obligated'),
    subgrants_count:           integer('subgrants_count').notNull().default(0),
    subgrants_obligated:       text('subgrants_obligated'),
    state_awards_count:        integer('state_awards_count').notNull().default(0),

    // Claimed-profile fields (set by the awardee themselves via "Claim" flow)
    claimed_at:                timestamp('claimed_at', { withTimezone: true }),
    claimed_by_org_id:         text('claimed_by_org_id'),
    capability_statement:      text('capability_statement'),
    teaming_goals_prime:       boolean('teaming_goals_prime').notNull().default(false),
    teaming_goals_sub:         boolean('teaming_goals_sub').notNull().default(false),
    highlight_profile:         boolean('highlight_profile').notNull().default(false),
    preferred_contact_email:   text('preferred_contact_email'),

    // AI / search
    profile_embedding:         vector('profile_embedding', { dimensions: 768 }),
    search_vector:             tsvector('search_vector'),

    is_stub:                   boolean('is_stub').notNull().default(false),
    created_at:                timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:                timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_awardee_uei').on(t.uei),
    uniqueIndex('uq_awardee_slug').on(t.slug),
    index('idx_awardee_parent').on(t.parent_awardee_id),
    index('idx_awardee_naics').on(t.primary_naics),
    index('idx_awardee_state').on(t.hq_state),
    index('idx_awardee_country').on(t.hq_country),
    index('idx_awardee_search').using('gin', t.search_vector),
    index('idx_awardee_name_trgm').using('gin', t.legal_name),
  ],
);

// ─── Partners (reciprocal sub/prime relationships) ─────────────────────────
export const awardee_partner = pgTable(
  'awardee_partner',
  {
    awardee_id:       text('awardee_id').notNull().references(() => awardees.awardee_id, { onDelete: 'cascade' }),
    partner_id:       text('partner_id').notNull().references(() => awardees.awardee_id, { onDelete: 'cascade' }),
    award_count:      integer('award_count').notNull().default(0),
    total_awarded:    text('total_awarded'),
    most_recent_at:   timestamp('most_recent_at', { withTimezone: true }),
    relationship:     text('relationship'),  // 'sub_to_prime' | 'prime_to_sub' | 'jv'
  },
  (t) => [
    uniqueIndex('uq_partner_pair').on(t.awardee_id, t.partner_id),
    index('idx_partner_awardee').on(t.awardee_id),
  ],
);

// ─── SBA mentor-protégé teams ──────────────────────────────────────────────
export const awardee_mentor = pgTable(
  'awardee_mentor',
  {
    mentor_id:      integer('mentor_id').generatedAlwaysAsIdentity().primaryKey(),
    mentor_awardee: text('mentor_awardee').notNull().references(() => awardees.awardee_id),
    protege_awardee:text('protege_awardee').notNull().references(() => awardees.awardee_id),
    approval_date:  timestamp('approval_date', { withTimezone: true }),
    sba_types:      jsonb('sba_types').$type<string[]>(),
    primary_naics:  text('primary_naics'),
    status:         text('status'),  // 'Active' | 'Expired' | 'Terminated'
  },
  (t) => [
    index('idx_mentor_mentor').on(t.mentor_awardee),
    index('idx_mentor_protege').on(t.protege_awardee),
  ],
);

// ─── Joint ventures ────────────────────────────────────────────────────────
export const awardee_jv = pgTable(
  'awardee_jv',
  {
    jv_id:          text('jv_id').primaryKey(),
    name:           text('name').notNull(),
    member_awardees:jsonb('member_awardees').$type<string[]>(),
    py_awards:      text('py_awards'),
  },
  (t) => [
    index('idx_jv_name_trgm').using('gin', t.name),
  ],
);

// ─── Awardee classifications history (so we can show "was 8(a) until 2024") ─
export const awardee_classification = pgTable(
  'awardee_classification',
  {
    awardee_id:     text('awardee_id').notNull().references(() => awardees.awardee_id, { onDelete: 'cascade' }),
    classification: text('classification').notNull(),
    effective_from: timestamp('effective_from', { withTimezone: true }),
    effective_to:   timestamp('effective_to', { withTimezone: true }),
    source_id:      text('source_id'),
  },
);

// ─── SAM.gov exclusions (debarment / suspension) ──────────────────────────
export const sam_exclusion = pgTable(
  'sam_exclusion',
  {
    exclusion_id:    text('exclusion_id').primaryKey(),
    awardee_id:      text('awardee_id').references(() => awardees.awardee_id),
    uei:             text('uei'),
    name:            text('name').notNull(),
    classification:  text('classification'),
    exclusion_type:  text('exclusion_type'),
    excluding_agency: text('excluding_agency'),
    activation_date: timestamp('activation_date', { withTimezone: true }),
    termination_date: timestamp('termination_date', { withTimezone: true }),
    cage:            text('cage'),
    is_active:       boolean('is_active').notNull().default(true),
  },
  (t) => [
    index('idx_excl_awardee').on(t.awardee_id),
    index('idx_excl_uei').on(t.uei),
    index('idx_excl_active').on(t.is_active),
  ],
);
