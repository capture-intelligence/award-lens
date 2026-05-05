/**
 * User-generated entities — pipelines, pursuits, activities, proposals,
 * saved searches, alerts, favorites, FOIA requests, API keys, downloads.
 *
 * All scoped to org_id for multi-user accounts.
 */
import {
  pgTable, text, integer, bigint, boolean, jsonb, timestamp, numeric, index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { app_user, organizations } from './auth.js';
import { vector } from '../custom-types.js';

// ─── Pipelines + stages ───────────────────────────────────────────────────
export const pipelines = pgTable(
  'pipelines',
  {
    pipeline_id: text('pipeline_id').primaryKey(),
    org_id:      text('org_id').notNull().references(() => organizations.org_id, { onDelete: 'cascade' }),
    owner_id:    text('owner_id').references(() => app_user.user_id),
    title:       text('title').notNull(),
    template:    text('template'),  // 'simple' | 'moderate' | 'advanced' | 'rfq' | 'custom'
    is_archived: boolean('is_archived').notNull().default(false),
    created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_pipeline_org').on(t.org_id),
    index('idx_pipeline_owner').on(t.owner_id),
  ],
);

export const pipeline_stages = pgTable(
  'pipeline_stages',
  {
    stage_id:    text('stage_id').primaryKey(),
    pipeline_id: text('pipeline_id').notNull().references(() => pipelines.pipeline_id, { onDelete: 'cascade' }),
    name:        text('name').notNull(),
    sort_order:  integer('sort_order').notNull().default(0),
    color:       text('color'),
    default_p_win:numeric('default_p_win'),
    default_p_go:numeric('default_p_go'),
  },
  (t) => [
    index('idx_stage_pipeline').on(t.pipeline_id, t.sort_order),
  ],
);

// ─── Pursuits ─────────────────────────────────────────────────────────────
export const pursuits = pgTable(
  'pursuits',
  {
    pursuit_id:        text('pursuit_id').primaryKey(),
    org_id:            text('org_id').notNull().references(() => organizations.org_id, { onDelete: 'cascade' }),
    pipeline_id:       text('pipeline_id').references(() => pipelines.pipeline_id, { onDelete: 'set null' }),
    stage_id:          text('stage_id').references(() => pipeline_stages.stage_id, { onDelete: 'set null' }),
    owner_id:          text('owner_id').references(() => app_user.user_id),

    name:              text('name').notNull(),
    pursuit_source:    text('pursuit_source'),
    pursuit_type:      text('pursuit_type'),

    // Probability + value
    p_win:             numeric('p_win'),
    p_go:              numeric('p_go'),
    unweighted_value:  bigint('unweighted_value', { mode: 'bigint' }),
    weighted_value:    bigint('weighted_value', { mode: 'bigint' }),

    // Linked opportunity
    opportunity_id:    text('opportunity_id'),
    opportunity_kind:  text('opportunity_kind'),  // 'contract' | 'grant'

    // Classification cache for filtering
    agency_id:         text('agency_id'),
    naics:             text('naics'),
    psc:               text('psc'),
    set_aside:         text('set_aside'),
    prime_or_sub:      text('prime_or_sub'),     // 'prime' | 'sub'

    // Dates
    due_date:          timestamp('due_date', { withTimezone: true }),
    award_date:        timestamp('award_date', { withTimezone: true }),
    solicitation_date: timestamp('solicitation_date', { withTimezone: true }),

    tags:              jsonb('tags').$type<string[]>(),
    notes:             text('notes'),

    is_no_bid:         boolean('is_no_bid').notNull().default(false),
    is_archived:       boolean('is_archived').notNull().default(false),

    created_at:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_pursuit_org').on(t.org_id),
    index('idx_pursuit_pipeline').on(t.pipeline_id),
    index('idx_pursuit_stage').on(t.stage_id),
    index('idx_pursuit_owner').on(t.owner_id),
    index('idx_pursuit_due').on(t.due_date),
    index('idx_pursuit_opp').on(t.opportunity_id),
    index('idx_pursuit_tags').using('gin', t.tags),
  ],
);

// ─── Activities (tasks, events on pursuits) ───────────────────────────────
export const activities = pgTable(
  'activities',
  {
    activity_id:    text('activity_id').primaryKey(),
    org_id:         text('org_id').notNull().references(() => organizations.org_id, { onDelete: 'cascade' }),
    pursuit_id:     text('pursuit_id').references(() => pursuits.pursuit_id, { onDelete: 'cascade' }),
    owner_id:       text('owner_id').references(() => app_user.user_id),
    name:           text('name').notNull(),
    activity_type:  text('activity_type'),  // 'task' | 'event' | 'call' | 'meeting'
    status:         text('status').notNull().default('open'),  // 'open' | 'complete'
    due_date:       timestamp('due_date', { withTimezone: true }),
    notes:          text('notes'),
    created_at:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_activity_org').on(t.org_id),
    index('idx_activity_pursuit').on(t.pursuit_id),
    index('idx_activity_owner').on(t.owner_id),
    index('idx_activity_due').on(t.due_date),
    index('idx_activity_status').on(t.status),
  ],
);

// ─── Proposals (Tiptap-based collaborative editor — DIFFERENTIATION) ──────
export const proposals = pgTable(
  'proposals',
  {
    proposal_id:    text('proposal_id').primaryKey(),
    org_id:         text('org_id').notNull().references(() => organizations.org_id, { onDelete: 'cascade' }),
    pursuit_id:     text('pursuit_id').references(() => pursuits.pursuit_id, { onDelete: 'set null' }),
    name:           text('name').notNull(),
    proposal_type:  text('proposal_type'),
    status:         text('status').notNull().default('draft'),  // 'draft' | 'in_review' | 'submitted' | 'won' | 'lost'
    template_id:    text('template_id'),
    sections:       jsonb('sections'),  // [{id, title, order, content_json, owner_id, status}]
    completion_pct: numeric('completion_pct').default('0'),
    created_by:     text('created_by').references(() => app_user.user_id),
    submitted_at:   timestamp('submitted_at', { withTimezone: true }),
    created_at:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_proposal_org').on(t.org_id),
    index('idx_proposal_pursuit').on(t.pursuit_id),
    index('idx_proposal_status').on(t.status),
  ],
);

// Proposal version history (Yjs-style snapshots)
export const proposal_revision = pgTable(
  'proposal_revision',
  {
    revision_id:  text('revision_id').primaryKey(),
    proposal_id:  text('proposal_id').notNull().references(() => proposals.proposal_id, { onDelete: 'cascade' }),
    snapshot_json: jsonb('snapshot_json').notNull(),
    created_by:   text('created_by').references(() => app_user.user_id),
    label:        text('label'),
    created_at:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_propver_proposal').on(t.proposal_id, t.created_at),
  ],
);

// Proposal comments
export const proposal_comment = pgTable(
  'proposal_comment',
  {
    comment_id:   text('comment_id').primaryKey(),
    proposal_id:  text('proposal_id').notNull().references(() => proposals.proposal_id, { onDelete: 'cascade' }),
    section_id:   text('section_id'),
    author_id:    text('author_id').notNull().references(() => app_user.user_id),
    parent_id:    text('parent_id'),  // threaded
    body:         text('body').notNull(),
    is_resolved:  boolean('is_resolved').notNull().default(false),
    mentions:     jsonb('mentions').$type<string[]>(),  // user_ids
    created_at:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_propcom_proposal').on(t.proposal_id),
    index('idx_propcom_author').on(t.author_id),
  ],
);

// ─── Saved searches + alerts (multi-channel — DIFFERENTIATION) ────────────
export const saved_searches = pgTable(
  'saved_searches',
  {
    search_id:        text('search_id').primaryKey(),
    org_id:           text('org_id').notNull().references(() => organizations.org_id, { onDelete: 'cascade' }),
    user_id:          text('user_id').notNull().references(() => app_user.user_id, { onDelete: 'cascade' }),
    name:             text('name').notNull(),
    entity_type:      text('entity_type').notNull(),  // 'contract_opportunity' | 'grant_opportunity' | etc.
    filters:          jsonb('filters').notNull(),
    last_result_count:integer('last_result_count'),
    last_run_at:      timestamp('last_run_at', { withTimezone: true }),
    is_team_shared:   boolean('is_team_shared').notNull().default(false),
    alert_frequency:  text('alert_frequency').notNull().default('daily'),  // 'never' | 'realtime' | 'daily' | 'weekly' | 'monthly'
    alert_channels:   jsonb('alert_channels').$type<{
                        email?: boolean;
                        slack?: boolean;
                        teams?: boolean;
                        webhook?: boolean;
                        sms?: boolean;
                      }>(),
    slack_webhook_url:  text('slack_webhook_url'),
    teams_webhook_url:  text('teams_webhook_url'),
    custom_webhook_url: text('custom_webhook_url'),
    sms_phone:        text('sms_phone'),
    notify_team:      boolean('notify_team').notNull().default(false),
    created_at:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_search_user').on(t.user_id),
    index('idx_search_org').on(t.org_id),
    index('idx_search_entity').on(t.entity_type),
    index('idx_search_frequency').on(t.alert_frequency),
  ],
);

// Alert delivery log (for each scheduled run)
export const alerts = pgTable(
  'alerts',
  {
    alert_id:      text('alert_id').primaryKey(),
    search_id:     text('search_id').notNull().references(() => saved_searches.search_id, { onDelete: 'cascade' }),
    new_results:   integer('new_results').notNull().default(0),
    delivered_at:  timestamp('delivered_at', { withTimezone: true }),
    channels_attempted: jsonb('channels_attempted').$type<string[]>(),
    channels_delivered: jsonb('channels_delivered').$type<string[]>(),
    error_summary: text('error_summary'),
    created_at:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_alert_search').on(t.search_id, t.created_at),
  ],
);

// ─── Favorites ────────────────────────────────────────────────────────────
export const favorites = pgTable(
  'favorites',
  {
    favorite_id:    text('favorite_id').primaryKey(),
    user_id:        text('user_id').notNull().references(() => app_user.user_id, { onDelete: 'cascade' }),
    org_id:         text('org_id').notNull().references(() => organizations.org_id, { onDelete: 'cascade' }),
    entity_type:    text('entity_type').notNull(),  // 'contract_opportunity', 'awardee', 'agency', etc.
    entity_id:      text('entity_id').notNull(),
    entity_name:    text('entity_name').notNull(),
    notes:          text('notes'),
    created_at:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_fav_user_entity').on(t.user_id, t.entity_type, t.entity_id),
    index('idx_fav_user').on(t.user_id),
    index('idx_fav_org').on(t.org_id),
    index('idx_fav_entity').on(t.entity_type, t.entity_id),
  ],
);

// ─── Tracked entities (Notify dropdown) ───────────────────────────────────
export const entity_watch = pgTable(
  'entity_watch',
  {
    watch_id:     text('watch_id').primaryKey(),
    user_id:      text('user_id').notNull().references(() => app_user.user_id, { onDelete: 'cascade' }),
    org_id:       text('org_id').notNull().references(() => organizations.org_id, { onDelete: 'cascade' }),
    entity_type:  text('entity_type').notNull(),
    entity_id:    text('entity_id').notNull(),
    notify_on:    jsonb('notify_on').$type<string[]>(),  // ['modification', 'expiration', 'protest', 'recompete']
    channels:     jsonb('channels').$type<{ email?: boolean; slack?: boolean; teams?: boolean }>(),
    created_at:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_watch_user_entity').on(t.user_id, t.entity_type, t.entity_id),
    index('idx_watch_entity').on(t.entity_type, t.entity_id),
  ],
);

// ─── FOIA requests ────────────────────────────────────────────────────────
export const foia_requests = pgTable(
  'foia_requests',
  {
    foia_id:        text('foia_id').primaryKey(),
    org_id:         text('org_id').notNull().references(() => organizations.org_id, { onDelete: 'cascade' }),
    user_id:        text('user_id').notNull().references(() => app_user.user_id),
    award_id:       text('award_id'),
    award_kind:     text('award_kind'),
    awardee_id:     text('awardee_id'),
    agency_id:      text('agency_id'),
    office_code:    text('office_code'),
    include_award_documents: boolean('include_award_documents').notNull().default(true),
    include_bidders_list:    boolean('include_bidders_list').notNull().default(false),
    include_research:        boolean('include_research').notNull().default(true),
    status:         text('status').notNull().default('submitted'),  // 'submitted' | 'in_progress' | 'delivered' | 'denied'
    request_letter_text: text('request_letter_text'),
    response_files: jsonb('response_files'),  // [{r2_key, filename, ...}]
    submitted_at:   timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    delivered_at:   timestamp('delivered_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_foia_org').on(t.org_id),
    index('idx_foia_user').on(t.user_id),
    index('idx_foia_status').on(t.status),
  ],
);

// ─── API keys (with usage tracking) ───────────────────────────────────────
export const api_keys = pgTable(
  'api_keys',
  {
    key_id:         text('key_id').primaryKey(),
    org_id:         text('org_id').notNull().references(() => organizations.org_id, { onDelete: 'cascade' }),
    user_id:        text('user_id').references(() => app_user.user_id),
    key_hash:       text('key_hash').notNull(),       // SHA-256 of the secret
    key_prefix:     text('key_prefix').notNull(),     // first 8 chars for display
    plan:           text('plan').notNull().default('free'),
    monthly_limit:  integer('monthly_limit').notNull().default(10000),
    label:          text('label'),
    last_used_at:   timestamp('last_used_at', { withTimezone: true }),
    revoked_at:     timestamp('revoked_at', { withTimezone: true }),
    created_at:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_apikey_hash').on(t.key_hash),
    index('idx_apikey_org').on(t.org_id),
    index('idx_apikey_prefix').on(t.key_prefix),
  ],
);

export const api_usage = pgTable(
  'api_usage',
  {
    usage_id:    integer('usage_id').generatedAlwaysAsIdentity().primaryKey(),
    key_id:      text('key_id').notNull().references(() => api_keys.key_id, { onDelete: 'cascade' }),
    endpoint:    text('endpoint').notNull(),
    record_count:integer('record_count').notNull().default(0),
    status_code: integer('status_code').notNull(),
    created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_apiusage_key').on(t.key_id, t.created_at),
  ],
);

// ─── Export jobs (background-rendered for >500 records) ───────────────────
export const downloads = pgTable(
  'downloads',
  {
    download_id:   text('download_id').primaryKey(),
    org_id:        text('org_id').notNull().references(() => organizations.org_id, { onDelete: 'cascade' }),
    user_id:       text('user_id').notNull().references(() => app_user.user_id),
    entity_type:   text('entity_type').notNull(),
    filters:       jsonb('filters'),
    columns:       jsonb('columns').$type<string[]>(),
    format:        text('format').notNull().default('csv'),  // 'csv' | 'xlsx' | 'json' | 'pdf'
    status:        text('status').notNull().default('queued'),  // 'queued' | 'processing' | 'complete' | 'failed'
    record_count:  integer('record_count'),
    file_size_bytes: bigint('file_size_bytes', { mode: 'bigint' }),
    r2_key:        text('r2_key'),
    download_url:  text('download_url'),
    expires_at:    timestamp('expires_at', { withTimezone: true }),
    error_summary: text('error_summary'),
    created_at:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completed_at:  timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_dl_org').on(t.org_id),
    index('idx_dl_user').on(t.user_id),
    index('idx_dl_status').on(t.status),
    index('idx_dl_expires').on(t.expires_at),
  ],
);

// ─── User profile vectors (for opportunity match scoring) ────────────────
export const user_profile_vector = pgTable(
  'user_profile_vector',
  {
    user_id:   text('user_id').primaryKey().references(() => app_user.user_id, { onDelete: 'cascade' }),
    vec:       vector('vec', { dimensions: 768 }),
    updated_at:timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

// ─── Notifications (in-app notification center — DIFFERENTIATION) ────────
export const notifications = pgTable(
  'notifications',
  {
    notification_id: text('notification_id').primaryKey(),
    user_id:         text('user_id').notNull().references(() => app_user.user_id, { onDelete: 'cascade' }),
    org_id:          text('org_id').notNull().references(() => organizations.org_id, { onDelete: 'cascade' }),
    notification_type: text('notification_type').notNull(),  // 'new_opp_match' | 'entity_change' | 'pipeline_activity' | 'alert_delivered' | 'foia_received' | 'mention'
    title:           text('title').notNull(),
    body:            text('body'),
    action_url:      text('action_url'),
    related_entity_type: text('related_entity_type'),
    related_entity_id:   text('related_entity_id'),
    is_read:         boolean('is_read').notNull().default(false),
    read_at:         timestamp('read_at', { withTimezone: true }),
    created_at:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_notif_user_unread').on(t.user_id, t.is_read, t.created_at),
  ],
);
