/**
 * Authentication, organizations, and per-org membership.
 *
 * Mirrors the existing D1 app_user / app_session / app_user_audit shape so
 * the Cloudflare Worker (workers/api) can write here directly during the
 * Postgres cutover. Adds organizations + memberships per spec §AccessControl.
 */
import {
  pgTable, text, timestamp, integer, boolean, index, uniqueIndex, primaryKey,
} from 'drizzle-orm/pg-core';

// ─── Organizations (multi-user accounts; spec §AccessControl) ──────────────

export const organizations = pgTable(
  'organizations',
  {
    org_id:           text('org_id').primaryKey(),
    name:             text('name').notNull(),
    slug:             text('slug').notNull(),
    plan:             text('plan').notNull().default('trial'),  // 'trial' | 'starter' | 'standard' | 'leader'
    seats:            integer('seats').notNull().default(1),
    export_limit:     integer('export_limit').notNull().default(1000),
    api_record_limit: integer('api_record_limit').notNull().default(10000),
    trial_ends_at:    timestamp('trial_ends_at', { withTimezone: true }),
    auto_renew:       boolean('auto_renew').notNull().default(true),
    capability_statement: text('capability_statement'),
    awardee_uei:      text('awardee_uei'),  // linked self-awardee for personalization
    teaming_prime:    boolean('teaming_prime').notNull().default(true),
    teaming_sub:      boolean('teaming_sub').notNull().default(true),
    highlight_profile: boolean('highlight_profile').notNull().default(false),
    created_at:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_org_slug').on(t.slug),
    index('idx_org_plan').on(t.plan),
  ],
);

// ─── Users ─────────────────────────────────────────────────────────────────

export const app_user = pgTable(
  'app_user',
  {
    user_id:        text('user_id').primaryKey(),
    org_id:         text('org_id').references(() => organizations.org_id, { onDelete: 'set null' }),
    email:          text('email').notNull(),
    display_name:   text('display_name'),
    avatar_url:     text('avatar_url'),
    provider:       text('provider').notNull(),         // 'google' | 'microsoft'
    provider_sub:   text('provider_sub').notNull(),
    role:           text('role').notNull().default('user'),  // 'admin' | 'member' | 'viewer' | 'pending' | 'rejected'
    approved_by:    text('approved_by'),
    approved_at:    timestamp('approved_at', { withTimezone: true }),
    rejected_at:    timestamp('rejected_at', { withTimezone: true }),
    last_login_at:  timestamp('last_login_at', { withTimezone: true }),
    // User preferences from spec §3.11 Profile
    show_opportunity_assistant: boolean('show_opportunity_assistant').notNull().default(true),
    show_match_score:           boolean('show_match_score').notNull().default(true),
    default_alert_frequency:    text('default_alert_frequency').notNull().default('daily'),
    digest_federal_contracts:   boolean('digest_federal_contracts').notNull().default(false),
    digest_sled:                boolean('digest_sled').notNull().default(false),
    digest_grants:              boolean('digest_grants').notNull().default(false),
    totp_enabled:               boolean('totp_enabled').notNull().default(false),
    created_at:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_user_provider').on(t.provider, t.provider_sub),
    uniqueIndex('uq_user_email').on(t.email),
    index('idx_user_org').on(t.org_id),
    index('idx_user_role').on(t.role),
  ],
);

// ─── Sessions ──────────────────────────────────────────────────────────────

export const app_session = pgTable(
  'app_session',
  {
    session_id:   text('session_id').primaryKey(),
    user_id:      text('user_id').notNull().references(() => app_user.user_id, { onDelete: 'cascade' }),
    expires_at:   timestamp('expires_at', { withTimezone: true }).notNull(),
    user_agent:   text('user_agent'),
    ip:           text('ip'),
    last_seen_at: timestamp('last_seen_at', { withTimezone: true }),
    created_at:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_session_user').on(t.user_id),
    index('idx_session_exp').on(t.expires_at),
  ],
);

// ─── Audit log ─────────────────────────────────────────────────────────────

export const app_user_audit = pgTable(
  'app_user_audit',
  {
    audit_id:    integer('audit_id').generatedAlwaysAsIdentity().primaryKey(),
    user_id:     text('user_id').notNull().references(() => app_user.user_id, { onDelete: 'cascade' }),
    actor_id:    text('actor_id').references(() => app_user.user_id),
    action:      text('action').notNull(),  // 'created','approved','rejected','role_changed','exported','reset'
    from_role:   text('from_role'),
    to_role:     text('to_role'),
    notes:       text('notes'),
    created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_audit_user').on(t.user_id, t.created_at),
  ],
);

// ─── Org invitations (spec calls for multi-user invite flow in Phase 1) ────

export const org_invitation = pgTable(
  'org_invitation',
  {
    invitation_id: text('invitation_id').primaryKey(),
    org_id:        text('org_id').notNull().references(() => organizations.org_id, { onDelete: 'cascade' }),
    email:         text('email').notNull(),
    role:          text('role').notNull().default('member'),
    invited_by:    text('invited_by').notNull().references(() => app_user.user_id),
    token_hash:    text('token_hash').notNull(),  // hashed; original sent in email
    expires_at:    timestamp('expires_at', { withTimezone: true }).notNull(),
    accepted_at:   timestamp('accepted_at', { withTimezone: true }),
    revoked_at:    timestamp('revoked_at', { withTimezone: true }),
    created_at:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_invite_org').on(t.org_id),
    uniqueIndex('uq_invite_token').on(t.token_hash),
  ],
);
