/**
 * Federal personnel — primarily contracting officers parsed from solicitation
 * documents and FPDS records. 212.2K target rows per spec §4. Visibility
 * follows the spec: full names only on /people/ detail; redacted in awardee
 * context tabs (handled at API serialization time, not at storage).
 */
import {
  pgTable, text, integer, boolean, jsonb, timestamp, index,
} from 'drizzle-orm/pg-core';
import { tsvector } from '../custom-types.js';

export const people = pgTable(
  'people',
  {
    person_id:          text('person_id').primaryKey(),
    slug:               text('slug').notNull(),
    name:               text('name').notNull(),
    title:              text('title'),
    email:              text('email'),
    email_domain:       text('email_domain'),  // ".gov" / ".mil"
    phone:              text('phone'),
    phone_country:      text('phone_country'),
    phone_state:        text('phone_state'),
    most_recent_agency_id: text('most_recent_agency_id'),
    last_activity_at:   timestamp('last_activity_at', { withTimezone: true }),
    last_seen_at:       timestamp('last_seen_at', { withTimezone: true }),
    profile_embedding_dims: integer('profile_embedding_dims').default(0),
    aliases:            jsonb('aliases').$type<string[]>(),
    is_active:          boolean('is_active').notNull().default(true),
    is_redacted:        boolean('is_redacted').notNull().default(false),
    search_vector:      tsvector('search_vector'),
    created_at:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_person_slug').on(t.slug),
    index('idx_person_agency').on(t.most_recent_agency_id),
    index('idx_person_email').on(t.email),
    index('idx_person_search').using('gin', t.search_vector),
    index('idx_person_name_trgm').using('gin', t.name),
  ],
);

// ─── Co-appearance graph (Colleagues tab) ─────────────────────────────────
export const person_colleague = pgTable(
  'person_colleague',
  {
    person_id:    text('person_id').notNull().references(() => people.person_id, { onDelete: 'cascade' }),
    colleague_id: text('colleague_id').notNull().references(() => people.person_id, { onDelete: 'cascade' }),
    co_count:     integer('co_count').notNull().default(1),
    last_seen_at: timestamp('last_seen_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_colleague_person').on(t.person_id),
  ],
);
