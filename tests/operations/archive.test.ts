import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import {
  archiveKey,
  seal,
  unseal,
  dumpDatabase,
  prepareRestore,
} from '../../scripts/operations/archive.mjs';
import { assessBudget } from '../../scripts/operations/budget.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  for (const name of readdirSync('apps/web/migrations')
    .filter((n) => n.endsWith('.sql'))
    .sort())
    db.exec(readFileSync(`apps/web/migrations/${name}`, 'utf8'));
  for (const owner of ['deleted-owner', 'kept-owner']) {
    db.prepare(
      'INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES(?,?,?,?,?)',
    ).run(owner, owner, `${owner}@example.invalid`, 1, 1);
    db.prepare(
      'INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,?,?,?,?)',
    ).run(owner, 10000, owner, 1, 1, owner);
    db.prepare(
      'INSERT INTO publication_intents(id,owner_id,idempotency_key,content_hash,visibility,report_json,size_bytes,origin,status,route_count,state,created_at,expires_at,verified_until) VALUES(?,?,?,\'hash\',\'PUBLIC\',\'{"private":"sample","startedAt":"2026-10-27T00:00:00Z","engineVersion":"test","job":{"discoveredRoutes":1,"stopReason":"DONE"},"routes":[]}\',20,\'https://example.invalid\',\'INCONCLUSIVE\',1,\'VERIFIED\',1,10000,10000)',
    ).run(owner, owner, owner);
    db.prepare(
      'INSERT INTO publications(id,intent_id,owner_id,author_name,content_hash,visibility,report_json,origin,status,route_count,size_bytes,token_hash,published_at) VALUES(?,?,?,\'author\',\'hash\',\'PUBLIC\',\'{"private":"sample","startedAt":"2026-10-27T00:00:00Z","engineVersion":"test","job":{"discoveredRoutes":1,"stopReason":"DONE"},"routes":[]}\',\'https://example.invalid\',\'INCONCLUSIVE\',1,20,\'old-token\',2)',
    ).run(owner, owner, owner);
  }
  db.prepare('UPDATE user SET name=? WHERE id=?').run(
    'nul\0name',
    'kept-owner',
  );
  db.prepare(
    'INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)',
  ).run(
    'credentials',
    'kept-owner',
    'credential',
    'kept-owner',
    'OLD-PASSWORD-HASH',
    1,
    1,
  );
  return db;
}
describe('private backups and safe restoration', () => {
  it('authenticates all encrypted bytes and rejects wrong keys and tampering', () => {
    const key = archiveKey('a'.repeat(64));
    const bytes = seal({ private: 'report' }, key);
    expect(unseal(bytes, key)).toEqual({ private: 'report' });
    expect(bytes.includes(Buffer.from('report'))).toBe(false);
    expect(() => unseal(bytes, archiveKey('b'.repeat(64)))).toThrow();
    bytes[bytes.length - 1] ^= 1;
    expect(() => unseal(bytes, key)).toThrow();
    expect(() => archiveKey('short')).toThrow();
  });
  it('applies later account erasure and invalidates all restored sessions and old sharing links', () => {
    const db = fixture();
    const now = Date.now();
    const backup = {
      kind: 'database',
      schemaVersion: 1,
      database: 'test',
      capturedAt: now - 10000,
      sql: dumpDatabase(db),
    };
    db.close();
    const ledger = {
      kind: 'erasure-ledger',
      schemaVersion: 1,
      database: 'test',
      capturedAt: now,
      events: [
        {
          id: 'delete-later',
          entity_type: 'account',
          entity_id: 'deleted-owner',
          action: 'delete',
          revision: null,
          created_at: now,
        },
      ],
    };
    const restored = new DatabaseSync(':memory:');
    restored.exec(prepareRestore(backup, ledger, now));
    expect(restored.prepare('SELECT id FROM user').all()).toEqual([
      { id: 'kept-owner' },
    ]);
    expect(
      restored
        .prepare(
          'SELECT state,visibility,token_hash,share_version FROM publications',
        )
        .all(),
    ).toEqual([
      {
        state: 'REVOKED',
        visibility: 'PRIVATE',
        token_hash: '',
        share_version: 2,
      },
    ]);
    expect(restored.prepare('SELECT * FROM session').all()).toEqual([]);
    expect(
      restored
        .prepare('SELECT state,report_json FROM publication_intents')
        .all(),
    ).toEqual([{ state: 'EXPIRED', report_json: null }]);
    expect(restored.prepare('SELECT id FROM erasure_log').all()).toContainEqual(
      { id: 'delete-later' },
    );
    expect(restored.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(
      restored.prepare("SELECT name FROM user WHERE id='kept-owner'").get()!
        .name,
    ).toBe('nul\0name');
    expect(
      restored.prepare('SELECT password FROM account').get()!.password,
    ).toBeNull();
    expect(
      restored.prepare('SELECT canceled_at FROM publication_intents').get()!
        .canceled_at,
    ).toBeGreaterThan(0);
    restored.close();
    expect(() =>
      prepareRestore(backup, { ...ledger, capturedAt: now - 600000 }, now),
    ).toThrow(/fresh/);
    expect(() =>
      prepareRestore(backup, { ...ledger, database: 'other' }, now),
    ).toThrow(/identity/);
  });
  it('removes a deleted report body while retaining the idempotency tombstone', () => {
    const db = fixture();
    const now = Date.now();
    const backup = {
      kind: 'database',
      schemaVersion: 1,
      database: 'test',
      capturedAt: now,
      sql: dumpDatabase(db),
    };
    db.close();
    const ledger = {
      kind: 'erasure-ledger',
      schemaVersion: 1,
      database: 'test',
      capturedAt: now,
      events: [
        {
          id: 'delete-report',
          entity_type: 'publication',
          entity_id: 'kept-owner',
          action: 'delete',
          revision: 2,
          created_at: now,
        },
      ],
    };
    const restored = new DatabaseSync(':memory:');
    restored.exec(prepareRestore(backup, ledger, now));
    expect(
      restored
        .prepare(
          "SELECT size_bytes,report_json,origin FROM publications WHERE id='kept-owner'",
        )
        .get(),
    ).toEqual({
      size_bytes: 0,
      report_json: 'null',
      origin: 'https://deleted.invalid',
    });
    expect(
      restored
        .prepare(
          "SELECT size_bytes FROM account_usage WHERE owner_id='kept-owner'",
        )
        .get(),
    ).toEqual({ size_bytes: 0 });
    restored.close();
  });
});
it('reports 50/80/95 percent thresholds and rejects missing or misleading measurements', () => {
  expect(
    assessBudget({
      metrics: [49, 50, 80, 95].map((used) => ({
        name: 'storage',
        used,
        limit: 100,
        unit: 'MiB',
      })),
    }).map((v) => v.level),
  ).toEqual(['normal', 'notice', 'warning', 'critical']);
  expect(() => assessBudget({ metrics: [] })).toThrow();
  expect(() =>
    assessBudget({
      metrics: [{ name: 'x', used: -1, limit: 2, unit: 'bytes' }],
    }),
  ).toThrow();
});
