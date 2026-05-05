/**
 * Classification reference data — NIA, NSN, SEWP catalog, DoD budget.
 *
 * Volumes per spec §4:
 *   nia_codes:    39
 *   nsn_items:    17M (demo: ~10K seeded)
 *   sewp_catalog: 11.8M (demo: ~5K seeded)
 *   dod_budget:   6.5K
 */
import {
  pgTable, text, integer, bigint, boolean, jsonb, timestamp, index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tsvector } from '../custom-types.js';

// ─── NIA — National Interest Actions (39 rows) ────────────────────────────
export const nia_codes = pgTable(
  'nia_codes',
  {
    nia_code:       text('nia_code').primaryKey(),
    slug:           text('slug').notNull(),
    name:           text('name').notNull(),
    established_year: integer('established_year'),
    description:    text('description'),
    contract_total: text('contract_total'),
    subcontract_total: text('subcontract_total'),
    grand_total:    text('grand_total'),
  },
  (t) => [
    uniqueIndex('uq_nia_slug').on(t.slug),
  ],
);

// ─── NSN — NATO Stock Number items (17M target, ~10K seeded for demo) ─────
export const nsn_items = pgTable(
  'nsn_items',
  {
    nsn:                text('nsn').primaryKey(),
    niin:               text('niin'),
    nomenclature:       text('nomenclature').notNull(),
    fsc_psc:            text('fsc_psc'),
    nsg:                text('nsg'),
    item_name:          text('item_name'),
    unit:               text('unit'),
    dod_standard_price: bigint('dod_standard_price', { mode: 'bigint' }),  // cents
    most_recent_price:  bigint('most_recent_price', { mode: 'bigint' }),
    amc:                text('amc'),  // Acquisition Method Code
    amsc:               text('amsc'),
    popularity:         integer('popularity'),
    niin_assigned_at:   timestamp('niin_assigned_at', { withTimezone: true }),
    is_seeded:          boolean('is_seeded').notNull().default(true),
    search_vector:      tsvector('search_vector'),
  },
  (t) => [
    index('idx_nsn_niin').on(t.niin),
    index('idx_nsn_fsc').on(t.fsc_psc),
    index('idx_nsn_search').using('gin', t.search_vector),
    index('idx_nsn_nomenclature_trgm').using('gin', t.nomenclature),
  ],
);

// ─── NSN suppliers (CAGE → NSN linkage) ───────────────────────────────────
export const nsn_supplier = pgTable(
  'nsn_supplier',
  {
    id:               integer('id').generatedAlwaysAsIdentity().primaryKey(),
    nsn:              text('nsn').notNull(),
    cage_code:        text('cage_code').notNull(),
    awardee_id:       text('awardee_id'),
    supplier_part:    text('supplier_part'),
    cage_status:      text('cage_status'),
    part_status:      text('part_status'),
  },
  (t) => [
    index('idx_nsnsup_nsn').on(t.nsn),
    index('idx_nsnsup_cage').on(t.cage_code),
  ],
);

// ─── SEWP catalog items (11.8M target, ~5K seeded) ────────────────────────
export const sewp_catalog = pgTable(
  'sewp_catalog',
  {
    catalog_id:       text('catalog_id').primaryKey(),
    sewp_awardee_id:  text('sewp_awardee_id'),
    sewp_contract_id: text('sewp_contract_id'),
    manufacturer:     text('manufacturer'),
    product_name:     text('product_name').notNull(),
    part_number:      text('part_number'),
    catalog_price:    bigint('catalog_price', { mode: 'bigint' }),  // cents
    is_seeded:        boolean('is_seeded').notNull().default(true),
    search_vector:    tsvector('search_vector'),
  },
  (t) => [
    index('idx_sewp_awardee').on(t.sewp_awardee_id),
    index('idx_sewp_contract').on(t.sewp_contract_id),
    index('idx_sewp_search').using('gin', t.search_vector),
    index('idx_sewp_product_trgm').using('gin', t.product_name),
  ],
);

// ─── DoD budget line items (6.5K) ─────────────────────────────────────────
export const dod_budget = pgTable(
  'dod_budget',
  {
    line_item_id:        text('line_item_id').primaryKey(),
    slug:                text('slug').notNull(),
    name:                text('name').notNull(),
    line_item_number:    text('line_item_number'),
    budget_category:     text('budget_category'),  // 'O&M' | 'Personnel' | 'Procurement' | 'RDT&E' | etc.
    agency_id:           text('agency_id'),
    budget_account:      text('budget_account'),
    budget_activity:     text('budget_activity'),
    fy26_request:        bigint('fy26_request', { mode: 'bigint' }),
    multi_year_history:  jsonb('multi_year_history'),  // [{fy, request, enacted}]
    description:         text('description'),
    previous_year_id:    text('previous_year_id'),
    search_vector:       tsvector('search_vector'),
  },
  (t) => [
    uniqueIndex('uq_budget_slug').on(t.slug),
    index('idx_budget_agency').on(t.agency_id),
    index('idx_budget_category').on(t.budget_category),
    index('idx_budget_search').using('gin', t.search_vector),
  ],
);
