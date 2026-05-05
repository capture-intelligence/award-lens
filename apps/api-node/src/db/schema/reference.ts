/**
 * Reference / lookup tables — full 2.7K NAICS, 3.8K PSC, country codes,
 * source systems, ingestion run log. All low-volume; copy-paste from public
 * authoritative sources (Census NAICS, GSA PSC manual, ISO countries).
 */
import {
  pgTable, text, integer, boolean, jsonb, timestamp, index,
} from 'drizzle-orm/pg-core';

// ─── NAICS codes (2.7K rows; spec §4 NAICS) ───────────────────────────────
export const naics_code = pgTable(
  'naics_code',
  {
    naics_code:         text('naics_code').primaryKey(),
    title:              text('title').notNull(),
    description:        text('description'),
    naics_level:        integer('naics_level'),                   // 2 / 3 / 4 / 5 / 6
    parent_code:        text('parent_code'),
    sba_size_standard:  text('sba_size_standard'),                // e.g. "$34 million" or "1500 employees"
    size_basis:         text('size_basis'),                       // 'revenue' | 'employees'
    examples:           jsonb('examples').$type<string[]>(),
    psc_crosswalk:      jsonb('psc_crosswalk').$type<string[]>(), // related PSC codes
    naics_alternatives: jsonb('naics_alternatives').$type<string[]>(),
    is_active:          boolean('is_active').notNull().default(true),
    year_edition:       integer('year_edition'),
    py_award_total:     text('py_award_total'),                   // bigint stored as text for >2^53
    py_award_count:     integer('py_award_count'),
  },
  (t) => [
    index('idx_naics_parent').on(t.parent_code),
    index('idx_naics_active').on(t.is_active),
  ],
);

// ─── PSC codes (3.8K rows; spec §4 PSC) ───────────────────────────────────
export const psc_code = pgTable(
  'psc_code',
  {
    psc_code:           text('psc_code').primaryKey(),
    title:              text('title').notNull(),
    description:        text('description'),
    product_or_service: text('product_or_service'),               // 'Product' | 'Service'
    category:           text('category'),
    is_active:          boolean('is_active').notNull().default(true),
    includes_notes:     text('includes_notes'),
    notes:              text('notes'),
    naics_crosswalk:    jsonb('naics_crosswalk').$type<string[]>(),
    psc_alternatives:   jsonb('psc_alternatives').$type<string[]>(),
    py_award_total:     text('py_award_total'),
    py_award_count:     integer('py_award_count'),
  },
  (t) => [
    index('idx_psc_category').on(t.category),
    index('idx_psc_active').on(t.is_active),
  ],
);

// ─── Country codes (ISO 3166-1) ───────────────────────────────────────────
export const country = pgTable('country', {
  country_code: text('country_code').primaryKey(),
  name:         text('name').notNull(),
  iso3:         text('iso3'),
});

// ─── US states (50 + DC + territories) ────────────────────────────────────
export const us_state = pgTable('us_state', {
  state_code: text('state_code').primaryKey(),  // 2-letter
  name:       text('name').notNull(),
  fips_code:  text('fips_code'),
  region:     text('region'),                   // 'Northeast' | 'Midwest' | 'South' | 'West'
});

// ─── Source systems (USAspending, SAM.gov, etc.) ──────────────────────────
export const source_system = pgTable('source_system', {
  source_id:    text('source_id').primaryKey(),
  display_name: text('display_name').notNull(),
  base_url:     text('base_url').notNull(),
  auth_type:    text('auth_type'),
  is_active:    boolean('is_active').notNull().default(true),
  cadence:      text('cadence'),                // 'realtime' | 'daily' | 'weekly' | 'monthly' | 'manual'
  ingestion_mode: text('ingestion_mode').notNull().default('seed'),  // 'live' | 'seed'
});

// ─── Ingestion run log ────────────────────────────────────────────────────
export const ingestion_run = pgTable(
  'ingestion_run',
  {
    run_id:           integer('run_id').generatedAlwaysAsIdentity().primaryKey(),
    source_id:        text('source_id').notNull().references(() => source_system.source_id),
    job_name:         text('job_name').notNull(),
    started_at:       timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finished_at:      timestamp('finished_at', { withTimezone: true }),
    status:           text('status').notNull(),           // 'running','success','partial','failed'
    watermark_before: text('watermark_before'),
    watermark_after:  text('watermark_after'),
    rows_fetched:     integer('rows_fetched').notNull().default(0),
    rows_upserted:    integer('rows_upserted').notNull().default(0),
    rows_failed:      integer('rows_failed').notNull().default(0),
    error_summary:    text('error_summary'),
    metadata:         jsonb('metadata'),
  },
  (t) => [
    index('idx_run_source_time').on(t.source_id, t.started_at),
    index('idx_run_status').on(t.status),
  ],
);
