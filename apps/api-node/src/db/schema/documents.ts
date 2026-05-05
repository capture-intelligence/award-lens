/**
 * Documents — solicitation attachments, RFIs, FOIA results. 7M target rows.
 * Demo dataset: ~5K documents, attachments only for the demo opportunities.
 *
 * Files live in R2 (key in `r2_key`); DB stores extracted text + metadata.
 */
import {
  pgTable, text, integer, bigint, boolean, jsonb, timestamp, index,
} from 'drizzle-orm/pg-core';
import { tsvector } from '../custom-types.js';

export const documents = pgTable(
  'documents',
  {
    document_id:         text('document_id').primaryKey(),
    filename:            text('filename').notNull(),
    file_format:         text('file_format'),  // 'pdf' | 'docx' | 'xlsx' | 'zip'
    file_size_bytes:     bigint('file_size_bytes', { mode: 'bigint' }),
    r2_key:              text('r2_key'),       // path in R2 bucket
    r2_public_url:       text('r2_public_url'),

    // Source / linkage
    related_opportunity_id: text('related_opportunity_id'),
    related_award_id:    text('related_award_id'),
    related_award_kind:  text('related_award_kind'),
    agency_id:           text('agency_id'),
    source:              text('source'),       // 'SAM.gov' | 'Federal Register' | 'FOIA'
    source_url:          text('source_url'),

    // Indexed text + AI snapshot
    extracted_text:      text('extracted_text'),
    text_snapshot:       text('text_snapshot'),       // short AI-extracted excerpt (✦ row label)
    snapshot_generated_at: timestamp('snapshot_generated_at', { withTimezone: true }),
    page_count:          integer('page_count'),

    posted_at:           timestamp('posted_at', { withTimezone: true }),
    last_modified_at:    timestamp('last_modified_at', { withTimezone: true }),
    is_indexed:          boolean('is_indexed').notNull().default(false),
    search_vector:       tsvector('search_vector'),
    created_at:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_doc_opp').on(t.related_opportunity_id),
    index('idx_doc_award').on(t.related_award_id),
    index('idx_doc_agency').on(t.agency_id),
    index('idx_doc_format').on(t.file_format),
    index('idx_doc_indexed').on(t.is_indexed),
    index('idx_doc_search').using('gin', t.search_vector),
    index('idx_doc_filename_trgm').using('gin', t.filename),
  ],
);

// Document mentions of people (powers Person.docs tab + Text Snapshot)
export const document_person = pgTable(
  'document_person',
  {
    document_id: text('document_id').notNull(),
    person_id:   text('person_id').notNull(),
    snippet:     text('snippet'),     // ~120-char excerpt around the mention
    page_number: integer('page_number'),
  },
  (t) => [
    index('idx_docperson_doc').on(t.document_id),
    index('idx_docperson_person').on(t.person_id),
  ],
);

// User annotations on documents (highlight, draw, link, text)
export const document_annotation = pgTable(
  'document_annotation',
  {
    annotation_id:  text('annotation_id').primaryKey(),
    document_id:    text('document_id').notNull(),
    user_id:        text('user_id').notNull(),
    org_id:         text('org_id'),
    annotation_type: text('annotation_type').notNull(),  // 'highlight' | 'draw' | 'text' | 'link'
    page_number:    integer('page_number'),
    geometry:       jsonb('geometry'),    // {x,y,w,h} or path data
    color:          text('color'),
    note:           text('note'),
    created_at:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_docanno_doc_user').on(t.document_id, t.user_id),
  ],
);
