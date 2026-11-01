import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core';
import { user } from './schema-auth';
import { publications } from './schema-publications';

/** Single-use Turnstile grants; owner/intent references intentionally have no foreign keys. */
export const challenges = sqliteTable(
  'challenges',
  {
    id: text('id').primaryKey(),
    action: text('action', { enum: ['auth', 'publish', 'abuse'] }).notNull(),
    owner_id: text('owner_id'),
    intent_id: text('intent_id'),
    cdata: text('cdata').notNull(),
    created_at: integer('created_at').notNull(),
    expires_at: integer('expires_at').notNull(),
    used: integer('used').notNull().default(0),
    verify_key: text('verify_key').notNull(),
  },
  (t) => [
    index('challenge_expiry_idx').on(t.expires_at),
    check('challenge_action', sql`${t.action} IN ('auth','publish','abuse')`),
  ],
);

/** Trigger-maintained storage and UTC daily publication counters. */
export const accountUsage = sqliteTable(
  'account_usage',
  {
    owner_id: text('owner_id')
      .primaryKey()
      .references(() => user.id),
    size_bytes: integer('size_bytes').notNull().default(0),
  },
  (t) => [check('usage_size', sql`${t.size_bytes} >= 0`)],
);
export const dailyUsage = sqliteTable(
  'daily_usage',
  {
    owner_id: text('owner_id')
      .notNull()
      .references(() => user.id),
    day: text('day').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.owner_id, t.day] })],
);

/** One report per reporter and publication, enforced by the database. */
export const abuseReports = sqliteTable(
  'abuse_reports',
  {
    id: text('id').primaryKey(),
    publication_id: text('publication_id')
      .notNull()
      .references(() => publications.id),
    reporter_id: text('reporter_id')
      .notNull()
      .references(() => user.id),
    category: text('category').notNull(),
    description: text('description').notNull(),
    state: text('state').notNull().default('OPEN'),
    created_at: integer('created_at').notNull(),
  },
  (t) => [unique().on(t.publication_id, t.reporter_id)],
);
export const moderationEvents = sqliteTable('moderation_events', {
  id: text('id').primaryKey(),
  publication_id: text('publication_id')
    .notNull()
    .references(() => publications.id),
  moderator_id: text('moderator_id')
    .notNull()
    .references(() => user.id),
  action: text('action').notNull(),
  reason: text('reason').notNull(),
  created_at: integer('created_at').notNull(),
});

/** Append-only recovery ledger. Migration triggers reject UPDATE and DELETE. */
export const erasureLog = sqliteTable(
  'erasure_log',
  {
    id: text('id').primaryKey(),
    entity_type: text('entity_type', {
      enum: ['account', 'publication'],
    }).notNull(),
    entity_id: text('entity_id').notNull(),
    action: text('action', {
      enum: ['delete', 'revoke', 'visibility', 'rotate-link'],
    }).notNull(),
    revision: integer('revision'),
    created_at: integer('created_at').notNull(),
  },
  (t) => [
    index('erasure_time_idx').on(t.created_at, t.id),
    check('erasure_entity', sql`${t.entity_type} IN ('account','publication')`),
    check(
      'erasure_action',
      sql`${t.action} IN ('delete','revoke','visibility','rotate-link')`,
    ),
  ],
);
/** Database identity must survive normal application writes and differ after a fresh migration. */
export const operationsMeta = sqliteTable('operations_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
