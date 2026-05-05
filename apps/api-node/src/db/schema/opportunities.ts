/**
 * Opportunities — contract solicitations, grant solicitations, forecasts, DIBBS.
 *
 * Volume targets per spec §4:
 *   contract_opportunities: 5.7M federal + 2.6M SLED = 8.3M
 *   grant_opportunities:    85K
 *   forecasts:              140.9K + 228.8K SLED
 *   dibbs_opportunities:    3M
 *
 * Demo-mode dataset at $0 ingests last 6 months only (~80K + ~10K + ~5K + 2K).
 * Full schema regardless so live ingestion drops in cleanly.
 */
import {
  pgTable, text, integer, bigint, boolean, jsonb, timestamp, index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tsvector, vector } from '../custom-types.js';

// ─── Contract opportunities (federal + SLED, distinguished by `scope`) ─────
export const contract_opportunities = pgTable(
  'contract_opportunities',
  {
    opportunity_id:    text('opportunity_id').primaryKey(),
    slug:              text('slug').notNull(),
    source_url_hash:   text('source_url_hash'),       // last segment of HigherGov-style /{slug}-{id}-{hash}/ URLs
    scope:             text('scope').notNull().default('federal'),  // 'federal' | 'sled'
    state_code:        text('state_code'),            // SLED only

    // Identity
    solicitation_number: text('solicitation_number'),
    title:               text('title').notNull(),
    type:                text('type'),                // 'Solicitation' | 'Special Notice' | 'Presolicitation' | 'Synopsis Solicitation' | 'Posted'

    // Agency
    agency_id:           text('agency_id'),
    funding_agency_id:   text('funding_agency_id'),
    awarding_office_id:  text('awarding_office_id'),
    funding_office_id:   text('funding_office_id'),

    // Classification
    set_aside:           text('set_aside'),
    naics:               text('naics'),
    psc:                 text('psc'),
    fsg:                 text('fsg'),
    nsg:                 text('nsg'),
    nsn:                 text('nsn'),
    is_sole_source:      boolean('is_sole_source').notNull().default(false),
    vehicle_id:          text('vehicle_id'),
    vehicle_type:        text('vehicle_type'),        // 'BPA' | 'IDIQ' | 'GWAC' | 'GSA Schedule' | etc.

    // Timing
    posted_at:           timestamp('posted_at', { withTimezone: true }),
    response_deadline:   timestamp('response_deadline', { withTimezone: true }),
    archive_at:          timestamp('archive_at', { withTimezone: true }),
    last_updated_at:     timestamp('last_updated_at', { withTimezone: true }),
    last_updated_by:     text('last_updated_by'),
    is_active:           boolean('is_active').notNull().default(true),

    // Place of performance
    pop_country:         text('pop_country'),
    pop_state:           text('pop_state'),
    pop_city:            text('pop_city'),
    pop_zip:             text('pop_zip'),

    // Source
    source:              text('source'),               // 'SAM.gov' | 'agency portal' | 'state portal'
    source_url:          text('source_url'),
    source_agency_hierarchy: text('source_agency_hierarchy'),
    fpds_org_code:       text('fpds_org_code'),
    sba_size_standard:   text('sba_size_standard'),

    // Description (raw + AI summary cached)
    description:         text('description'),
    description_summary: text('description_summary'),  // AI-generated, marked with ✦
    summary_generated_at: timestamp('summary_generated_at', { withTimezone: true }),
    summary_model:       text('summary_model'),

    // AI predictions (pre-computed at index time, never on demand)
    ai_value_min:        bigint('ai_value_min', { mode: 'bigint' }),
    ai_value_max:        bigint('ai_value_max', { mode: 'bigint' }),
    ai_pricing_type:     text('ai_pricing_type'),      // 'Fixed Price' | 'Cost Plus' | 'T&M' | etc.
    ai_estimated_at:     timestamp('ai_estimated_at', { withTimezone: true }),

    // Embeddings for similarity + match scoring
    description_embedding: vector('description_embedding', { dimensions: 768 }),

    // Search
    search_vector:       tsvector('search_vector'),

    // Contacts (denormalized — full contact records live in `people`)
    primary_contact_id:  text('primary_contact_id'),

    // Relationships count snapshot (refreshed nightly)
    bidders_count:       integer('bidders_count').notNull().default(0),
    similar_count:       integer('similar_count').notNull().default(0),
    documents_count:     integer('documents_count').notNull().default(0),
    incumbents_count:    integer('incumbents_count').notNull().default(0),

    raw_payload:         jsonb('raw_payload'),
    created_at:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_opp_slug').on(t.slug),
    index('idx_opp_scope').on(t.scope),
    index('idx_opp_state').on(t.state_code),
    index('idx_opp_agency').on(t.agency_id),
    index('idx_opp_naics').on(t.naics),
    index('idx_opp_psc').on(t.psc),
    index('idx_opp_set_aside').on(t.set_aside),
    index('idx_opp_active').on(t.is_active),
    index('idx_opp_posted').on(t.posted_at),
    index('idx_opp_deadline').on(t.response_deadline),
    index('idx_opp_search').using('gin', t.search_vector),
    index('idx_opp_title_trgm').using('gin', t.title),
    index('idx_opp_embedding').using('hnsw', t.description_embedding),  // pgvector HNSW
  ],
);

// ─── Forecasts (procurement/grant pipeline forecasts) ──────────────────────
export const forecasts = pgTable(
  'forecasts',
  {
    forecast_id:        text('forecast_id').primaryKey(),
    slug:               text('slug').notNull(),
    scope:              text('scope').notNull().default('federal'),  // 'federal' | 'sled'
    forecast_type:      text('forecast_type'),  // 'contract' | 'grant'
    title:              text('title').notNull(),
    agency_id:          text('agency_id'),
    naics:              text('naics'),
    psc:                text('psc'),
    set_aside:          text('set_aside'),
    min_value:          bigint('min_value', { mode: 'bigint' }),
    max_value:          bigint('max_value', { mode: 'bigint' }),
    posted_at:          timestamp('posted_at', { withTimezone: true }),
    anticipated_award_at: timestamp('anticipated_award_at', { withTimezone: true }),
    description:        text('description'),
    description_summary: text('description_summary'),
    source:             text('source'),
    raw_payload:        jsonb('raw_payload'),
    search_vector:      tsvector('search_vector'),
    created_at:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_fcst_scope').on(t.scope),
    index('idx_fcst_agency').on(t.agency_id),
    index('idx_fcst_naics').on(t.naics),
    index('idx_fcst_search').using('gin', t.search_vector),
  ],
);

// ─── DIBBS opportunities (DLA portal) — small/mostly seeded for $0 demo ───
export const dibbs_opportunities = pgTable(
  'dibbs_opportunities',
  {
    dibbs_id:        text('dibbs_id').primaryKey(),
    title:           text('title').notNull(),
    nsn:             text('nsn'),
    agency_id:       text('agency_id'),
    quantity:        integer('quantity'),
    unit:            text('unit'),
    posted_at:       timestamp('posted_at', { withTimezone: true }),
    closing_at:      timestamp('closing_at', { withTimezone: true }),
    description:     text('description'),
    is_seeded:       boolean('is_seeded').notNull().default(true),  // demo-mode flag
    search_vector:   tsvector('search_vector'),
  },
  (t) => [
    index('idx_dibbs_nsn').on(t.nsn),
    index('idx_dibbs_search').using('gin', t.search_vector),
  ],
);

// ─── Grant opportunities ──────────────────────────────────────────────────
export const grant_opportunities = pgTable(
  'grant_opportunities',
  {
    opportunity_id:     text('opportunity_id').primaryKey(),
    slug:               text('slug').notNull(),

    title:              text('title').notNull(),
    type:               text('type'),  // 'Posted' | 'Forecasted' | 'Closed'
    agency_id:          text('agency_id'),
    cfda_program:       text('cfda_program'),  // CFDA / Assistance Listing number
    funding_amount:     bigint('funding_amount', { mode: 'bigint' }),
    category_of_funding:text('category_of_funding'),
    funding_instruments: jsonb('funding_instruments').$type<string[]>(),
    grant_category:     text('grant_category'),  // 'Discretionary' | 'Formula' | etc.
    cost_sharing:       boolean('cost_sharing').notNull().default(false),

    posted_at:          timestamp('posted_at', { withTimezone: true }),
    closing_at:         timestamp('closing_at', { withTimezone: true }),
    archive_at:         timestamp('archive_at', { withTimezone: true }),
    last_updated_at:    timestamp('last_updated_at', { withTimezone: true }),
    version:            integer('version'),
    is_active:          boolean('is_active').notNull().default(true),

    eligible_applicants: text('eligible_applicants'),
    ceiling:            bigint('ceiling', { mode: 'bigint' }),
    floor:              bigint('floor', { mode: 'bigint' }),
    estimated_program_funding: bigint('estimated_program_funding', { mode: 'bigint' }),
    estimated_number_of_grants: integer('estimated_number_of_grants'),

    description:        text('description'),
    description_summary: text('description_summary'),
    summary_generated_at: timestamp('summary_generated_at', { withTimezone: true }),
    summary_model:      text('summary_model'),

    description_embedding: vector('description_embedding', { dimensions: 768 }),
    search_vector:      tsvector('search_vector'),

    source:             text('source').default('Grants.gov'),
    source_url:         text('source_url'),
    raw_payload:        jsonb('raw_payload'),

    created_at:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_grant_opp_slug').on(t.slug),
    index('idx_grant_opp_agency').on(t.agency_id),
    index('idx_grant_opp_cfda').on(t.cfda_program),
    index('idx_grant_opp_active').on(t.is_active),
    index('idx_grant_opp_posted').on(t.posted_at),
    index('idx_grant_opp_search').using('gin', t.search_vector),
    index('idx_grant_opp_title_trgm').using('gin', t.title),
    index('idx_grant_opp_embedding').using('hnsw', t.description_embedding),
  ],
);

// ─── Opportunity contacts (M:N — opps can have multiple contacts) ─────────
export const opportunity_contact = pgTable(
  'opportunity_contact',
  {
    opportunity_id: text('opportunity_id').notNull(),
    person_id:      text('person_id').notNull(),
    role:           text('role'),  // 'primary' | 'secondary' | 'attorney'
    opp_kind:       text('opp_kind').notNull(),  // 'contract' | 'grant'
  },
  (t) => [
    index('idx_oppcontact_opp').on(t.opportunity_id),
    index('idx_oppcontact_person').on(t.person_id),
  ],
);

// ─── Bidders/Applicants linkage (potential bidders shown on detail page) ──
export const opportunity_bidder = pgTable(
  'opportunity_bidder',
  {
    opportunity_id: text('opportunity_id').notNull(),
    awardee_id:     text('awardee_id').notNull(),
    obligated_2025: text('obligated_2025'),
    rank:           integer('rank'),
    opp_kind:       text('opp_kind').notNull(),  // 'contract' | 'grant'
  },
  (t) => [
    index('idx_oppbid_opp').on(t.opportunity_id),
  ],
);

// ─── Similar opportunities (precomputed by embedding similarity job) ──────
export const opportunity_similar = pgTable(
  'opportunity_similar',
  {
    opportunity_id: text('opportunity_id').notNull(),
    similar_id:     text('similar_id').notNull(),
    similarity:     text('similarity').notNull(),  // numeric stored as text for portability
    opp_kind:       text('opp_kind').notNull(),
  },
  (t) => [
    index('idx_oppsim_opp').on(t.opportunity_id),
  ],
);
