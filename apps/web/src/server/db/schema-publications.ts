import { desc, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core';
import { user } from './schema-auth';

/** Frozen approved snapshots. Lifecycle and quota triggers remain in migrations. */
export const publicationIntents = sqliteTable(
  'publication_intents',
  {
    id: text('id').primaryKey(),
    owner_id: text('owner_id')
      .notNull()
      .references(() => user.id),
    idempotency_key: text('idempotency_key').notNull(),
    content_hash: text('content_hash').notNull(),
    visibility: text('visibility', {
      enum: ['PRIVATE', 'UNLISTED', 'PUBLIC'],
    }).notNull(),
    report_json: text('report_json'),
    size_bytes: integer('size_bytes').notNull(),
    origin: text('origin').notNull(),
    status: text('status').notNull(),
    route_count: integer('route_count').notNull(),
    state: text('state', {
      enum: ['PENDING', 'VERIFIED', 'CONSUMED', 'EXPIRED'],
    })
      .notNull()
      .default('PENDING'),
    created_at: integer('created_at').notNull(),
    expires_at: integer('expires_at').notNull(),
    verified_until: integer('verified_until'),
    canceled_at: integer('canceled_at'),
  },
  (t) => [
    unique().on(t.owner_id, t.idempotency_key),
    index('intent_owner_expiry_idx').on(t.owner_id, t.expires_at),
    check(
      'intent_visibility',
      sql`${t.visibility} IN ('PRIVATE','UNLISTED','PUBLIC')`,
    ),
    check(
      'intent_size',
      sql`${t.size_bytes} > 0 AND ${t.size_bytes} <= 1048576`,
    ),
    check(
      'intent_state',
      sql`${t.state} IN ('PENDING','VERIFIED','CONSUMED','EXPIRED')`,
    ),
  ],
);

/** Published snapshots and metadata; integer timestamps preserve the storage/API contract. */
export const publications = sqliteTable(
  'publications',
  {
    id: text('id').primaryKey(),
    intent_id: text('intent_id')
      .notNull()
      .unique()
      .references(() => publicationIntents.id),
    owner_id: text('owner_id')
      .notNull()
      .references(() => user.id),
    author_name: text('author_name').notNull(),
    content_hash: text('content_hash').notNull(),
    visibility: text('visibility', {
      enum: ['PRIVATE', 'UNLISTED', 'PUBLIC'],
    }).notNull(),
    state: text('state', {
      enum: ['ACTIVE', 'REVOKED', 'HIDDEN_BY_MODERATION'],
    })
      .notNull()
      .default('ACTIVE'),
    revision: integer('revision').notNull().default(1),
    report_json: text('report_json').notNull(),
    origin: text('origin').notNull(),
    status: text('status').notNull(),
    route_count: integer('route_count').notNull(),
    size_bytes: integer('size_bytes').notNull(),
    token_hash: text('token_hash').notNull(),
    share_version: integer('share_version').notNull().default(1),
    published_at: integer('published_at').notNull(),
    revoked_at: integer('revoked_at'),
    moderation_reason: text('moderation_reason'),
    audited_at: integer('audited_at').notNull().default(0),
    discovered_count: integer('discovered_count').notNull().default(0),
    measured_count: integer('measured_count').notNull().default(0),
    scenario_count: integer('scenario_count').notNull().default(0),
    candidate_count: integer('candidate_count').notNull().default(0),
    engine_version: text('engine_version').notNull().default(''),
    stop_reason: text('stop_reason').notNull().default(''),
    public_origin_allowed: integer('public_origin_allowed')
      .notNull()
      .default(0),
  },
  (t) => [
    index('public_index_idx').on(
      t.visibility,
      t.state,
      desc(t.published_at),
      desc(t.id),
    ),
    index('public_origin_idx').on(
      t.visibility,
      t.state,
      t.origin,
      desc(t.published_at),
    ),
    index('publication_owner_idx').on(t.owner_id, desc(t.published_at)),
    index('public_audit_filter_idx').on(
      t.visibility,
      t.state,
      desc(t.audited_at),
      t.status,
    ),
    index('public_allowed_index_idx').on(
      t.visibility,
      t.state,
      t.public_origin_allowed,
      desc(t.published_at),
      desc(t.id),
    ),
    index('public_allowed_origin_idx').on(
      t.visibility,
      t.state,
      t.public_origin_allowed,
      t.origin,
      desc(t.published_at),
    ),
    check(
      'publication_visibility',
      sql`${t.visibility} IN ('PRIVATE','UNLISTED','PUBLIC')`,
    ),
    check(
      'publication_state',
      sql`${t.state} IN ('ACTIVE','REVOKED','HIDDEN_BY_MODERATION')`,
    ),
    check(
      'publication_origin_allowed',
      sql`${t.public_origin_allowed} IN (0,1)`,
    ),
  ],
);
