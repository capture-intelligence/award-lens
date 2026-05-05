/**
 * Labor pricing + news articles.
 *
 * Volumes per spec §4:
 *   labor_pricing: 665.8K (demo: ~20K from public GSA Schedule CSV)
 *   news_articles: 87.6K (demo: pulled live from RSS — DefenseNews,
 *                          NextGov, FedScoop, Federal News Network)
 */
import {
  pgTable, text, integer, bigint, boolean, jsonb, timestamp, index,
} from 'drizzle-orm/pg-core';
import { tsvector } from '../custom-types.js';

// ─── Labor pricing records (GSA Schedule + FAA eFAST) ─────────────────────
export const labor_pricing = pgTable(
  'labor_pricing',
  {
    rate_id:          text('rate_id').primaryKey(),
    hourly_rate_cents: bigint('hourly_rate_cents', { mode: 'bigint' }).notNull(),
    labor_category:   text('labor_category').notNull(),
    description:      text('description'),
    experience_level: text('experience_level'),  // years or band
    education_level:  text('education_level'),   // 'High School' | 'Bachelor's' | 'Master's' | 'PhD'
    contractor_name:  text('contractor_name'),
    contractor_awardee_id: text('contractor_awardee_id'),
    contract_number:  text('contract_number'),
    contract_type:    text('contract_type'),
    region:           text('region'),
    source:           text('source').notNull(),  // 'gsa_schedule' | 'faa_efast' | 'other'
    effective_at:     timestamp('effective_at', { withTimezone: true }),
    search_vector:    tsvector('search_vector'),
  },
  (t) => [
    index('idx_labor_rate').on(t.hourly_rate_cents),
    index('idx_labor_source').on(t.source),
    index('idx_labor_contractor').on(t.contractor_awardee_id),
    index('idx_labor_search').using('gin', t.search_vector),
    index('idx_labor_category_trgm').using('gin', t.labor_category),
  ],
);

// ─── News articles (RSS-fed; full-text search + category filter — DIFFERENTIATION) ──
export const news_articles = pgTable(
  'news_articles',
  {
    article_id:    text('article_id').primaryKey(),
    slug:          text('slug').notNull(),
    headline:      text('headline').notNull(),
    summary:       text('summary'),
    body:          text('body'),
    source:        text('source'),  // 'DefenseNews' | 'NextGov' | 'FedScoop' | 'Federal News Network' | 'CaptureRadar'
    source_url:    text('source_url'),
    thumbnail_url: text('thumbnail_url'),
    category:      text('category'),  // 'Contract Award' | 'Defense' | 'Civilian' | 'Grants' | 'SLED' | 'M&A' | 'Analysis'
    tags:          jsonb('tags').$type<string[]>(),
    related_agency_id: text('related_agency_id'),
    related_awardee_id: text('related_awardee_id'),
    published_at:  timestamp('published_at', { withTimezone: true }),
    fetched_at:    timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    search_vector: tsvector('search_vector'),
  },
  (t) => [
    index('idx_news_source').on(t.source),
    index('idx_news_category').on(t.category),
    index('idx_news_published').on(t.published_at),
    index('idx_news_search').using('gin', t.search_vector),
    index('idx_news_headline_trgm').using('gin', t.headline),
  ],
);
