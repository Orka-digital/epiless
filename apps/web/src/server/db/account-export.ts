import { and, asc, eq, ne } from 'drizzle-orm';
import { database } from './client';
import {
  user as u,
  session as s,
  publications as p,
  publicationIntents as i,
  abuseReports as a,
  moderationEvents as m,
} from './schema';
import type { RuntimeEnv } from '../types';

/** Explicit allowlists exclude credentials, token hashes and grants. D1 batch preserves a
 * consistent export boundary; Date/boolean auth values are converted back to v1 JSON integers.
 */
export async function accountExportRows(env: RuntimeEnv, ownerId: string) {
  const db = database(env);
  const [
    accounts,
    publications,
    intents,
    abuseReports,
    moderationActions,
    sessions,
  ] = await db.batch([
    db
      .select({
        id: u.id,
        name: u.name,
        email: u.email,
        emailVerified: u.emailVerified,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      })
      .from(u)
      .where(eq(u.id, ownerId)),
    db
      .select({
        id: p.id,
        content_hash: p.content_hash,
        visibility: p.visibility,
        state: p.state,
        revision: p.revision,
        report_json: p.report_json,
        published_at: p.published_at,
        revoked_at: p.revoked_at,
        moderation_reason: p.moderation_reason,
      })
      .from(p)
      .where(eq(p.owner_id, ownerId))
      .orderBy(asc(p.published_at), asc(p.id)),
    db
      .select({
        id: i.id,
        content_hash: i.content_hash,
        visibility: i.visibility,
        state: i.state,
        report_json: i.report_json,
        created_at: i.created_at,
        expires_at: i.expires_at,
        canceled_at: i.canceled_at,
      })
      .from(i)
      .where(and(eq(i.owner_id, ownerId), ne(i.state, 'CONSUMED'))),
    db
      .select({
        id: a.id,
        publication_id: a.publication_id,
        category: a.category,
        description: a.description,
        state: a.state,
        created_at: a.created_at,
      })
      .from(a)
      .where(eq(a.reporter_id, ownerId)),
    db
      .select({
        id: m.id,
        publication_id: m.publication_id,
        action: m.action,
        reason: m.reason,
        created_at: m.created_at,
      })
      .from(m)
      .where(eq(m.moderator_id, ownerId)),
    db
      .select({
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        expiresAt: s.expiresAt,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
      })
      .from(s)
      .where(eq(s.userId, ownerId)),
  ]);
  const account = accounts[0];
  return {
    account: account
      ? {
          ...account,
          emailVerified: Number(account.emailVerified),
          createdAt: account.createdAt.getTime(),
          updatedAt: account.updatedAt.getTime(),
        }
      : undefined,
    publications,
    intents,
    abuseReports,
    moderationActions,
    sessions: sessions.map((row) => ({
      ...row,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
      expiresAt: row.expiresAt.getTime(),
    })),
  };
}
