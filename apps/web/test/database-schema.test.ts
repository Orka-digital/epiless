import { afterEach, describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from '../src/server/db/schema';
import { database, databaseErrorIncludes } from '../src/server/db/client';
import { accountExportRows } from '../src/server/db/account-export';
import { eraseAccount } from '../src/server/db/account-erasure';
import { testDatabase } from '../../../tests/backend/database';
import type { RuntimeEnv } from '../src/server/types';

let fixture: ReturnType<typeof testDatabase> | undefined;
afterEach(() => {
  fixture?.sqlite.close();
  fixture = undefined;
});

function setup() {
  fixture = testDatabase();
  return { fixture, env: { DB: fixture.db } as RuntimeEnv };
}

describe('shared database contract', () => {
  it('covers every migrated table and column with compatible nullability, defaults, keys and indexes', async () => {
    const { fixture, env } = setup();
    const tables = Object.values(schema).map(getTableConfig);
    const actual = fixture.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all();
    expect(tables.map((t) => t.name).sort()).toEqual(
      actual.map((t) => t.name).sort(),
    );
    for (const table of Object.values(schema)) {
      const config = getTableConfig(table);
      const columns = fixture.sqlite
        .prepare(`PRAGMA table_info('${config.name}')`)
        .all();
      expect(config.columns.map((c) => c.name).sort()).toEqual(
        columns.map((c) => c.name).sort(),
      );
      for (const column of config.columns) {
        const actual = columns.find((c) => c.name === column.name)!;
        expect(column.getSQLType().toUpperCase()).toBe(actual.type);
        // SQLite permits NULL for a non-integer inline PRIMARY KEY despite Drizzle's inferred notNull.
        if (!column.primary)
          expect(Number(column.notNull)).toBe(actual.notnull);
        if (column.default !== undefined) {
          const expected =
            typeof column.default === 'boolean'
              ? String(Number(column.default))
              : typeof column.default === 'string'
                ? `'${column.default}'`
                : String(column.default);
          expect(actual.dflt_value).toBe(expected);
        } else expect(actual.dflt_value).toBeNull();
        if (column.primary) expect(actual.pk).toBe(1);
      }
      const indexes = fixture.sqlite
        .prepare(`PRAGMA index_list('${config.name}')`)
        .all();
      expect(config.indexes.map((i) => i.config.name).sort()).toEqual(
        indexes
          .filter((i) => i.origin === 'c')
          .map((i) => i.name)
          .sort(),
      );
      const foreignKeys = fixture.sqlite
        .prepare(`PRAGMA foreign_key_list('${config.name}')`)
        .all();
      expect(config.foreignKeys).toHaveLength(foreignKeys.length);
      for (const key of config.foreignKeys) {
        const reference = key.reference();
        expect(foreignKeys).toContainEqual(
          expect.objectContaining({
            from: reference.columns[0].name,
            to: reference.foreignColumns[0].name,
            table: getTableConfig(reference.foreignTable).name,
            on_delete: (key.onDelete ?? 'no action').toUpperCase(),
          }),
        );
      }
      // Exercise actual generated SELECTs against all applied migrations, including operations-only tables.
      await expect(
        database(env).select().from(table).all(),
      ).resolves.toBeInstanceOf(Array);
    }
  });

  it('keeps export v1 timestamps and flags numeric and excludes auth secrets', async () => {
    const { fixture, env } = setup();
    const time = 1720000000123;
    fixture.sqlite
      .prepare(
        'INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
      )
      .run('owner', 'Owner', 'owner@example.com', 1, time, time);
    fixture.sqlite
      .prepare(
        'INSERT INTO session(id,token,userId,createdAt,updatedAt,expiresAt) VALUES(?,?,?,?,?,?)',
      )
      .run('session', 'secret-token', 'owner', time, time, time + 60000);
    const result = await accountExportRows(env, 'owner');
    expect(result.account).toEqual({
      id: 'owner',
      name: 'Owner',
      email: 'owner@example.com',
      emailVerified: 1,
      createdAt: time,
      updatedAt: time,
    });
    expect(result.sessions).toEqual([
      {
        createdAt: time,
        updatedAt: time,
        expiresAt: time + 60000,
        ipAddress: null,
        userAgent: null,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  it('rolls back the erasure ledger and auth deletion if any ordered erasure step fails', async () => {
    const { fixture, env } = setup();
    fixture.sqlite.exec(
      "INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('owner','Owner','owner@example.com',1,1)",
    );
    fixture.sqlite.exec(
      "CREATE TRIGGER reject_user_delete BEFORE DELETE ON user BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
    );
    await expect(eraseAccount(env, 'owner')).rejects.toThrow('fixture failure');
    expect(fixture.sqlite.prepare('SELECT id FROM user').all()).toHaveLength(1);
    expect(
      fixture.sqlite.prepare('SELECT * FROM erasure_log').all(),
    ).toHaveLength(0);
  });

  it('recognizes wrapped quota failures without following cyclic causes forever', () => {
    const cause = new Error('PENDING_QUOTA');
    const wrapped = new Error('Failed query', { cause });
    expect(databaseErrorIncludes(wrapped, 'PENDING_QUOTA')).toBe(true);
    cause.cause = wrapped;
    expect(databaseErrorIncludes(wrapped, 'OTHER')).toBe(false);
  });
});
