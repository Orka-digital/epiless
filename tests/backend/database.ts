import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

/** Executes the actual D1 migration and SQL against SQLite, including transactions/triggers. */
export function testDatabase(): { db: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const migrations = new URL('../../apps/web/migrations/', import.meta.url);
  for (const migration of readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    sqlite.exec(readFileSync(new URL(migration, migrations), 'utf8'));
  }
  class Statement {
    constructor(
      public query: string,
      public values: unknown[] = [],
    ) {}
    bind(...values: unknown[]) {
      return new Statement(this.query, values);
    }
    async first(column?: string) {
      const row = sqlite
        .prepare(this.query)
        .get(...(this.values as never[])) as
        Record<string, unknown> | undefined;
      return column ? (row?.[column] ?? null) : (row ?? null);
    }
    async all() {
      const results = sqlite
        .prepare(this.query)
        .all(...(this.values as never[]));
      return {
        results,
        success: true,
        meta: {
          changes: Number(sqlite.prepare('SELECT changes() AS n').get()!.n),
        },
      };
    }
    async raw(options?: { columnNames?: boolean }) {
      const statement = sqlite.prepare(this.query);
      statement.setReturnArrays(true);
      const rows = statement.all(...(this.values as never[]));
      return options?.columnNames
        ? [statement.columns().map((column) => column.name), ...rows]
        : rows;
    }
    async run() {
      const result = sqlite
        .prepare(this.query)
        .run(...(this.values as never[]));
      return {
        results: [],
        success: true,
        meta: {
          changes: Number(result.changes),
          last_row_id: Number(result.lastInsertRowid),
        },
      };
    }
  }
  const adapter = {
    prepare(query: string) {
      return new Statement(query);
    },
    async batch(statements: Statement[]) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    async exec(query: string) {
      sqlite.exec(query);
      return { count: 1, duration: 0 };
    },
  };
  return { db: adapter as unknown as D1Database, sqlite };
}
