import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';
import type { RuntimeEnv } from '../types';

/** Bind the shared schema to this request's D1 database without caching runtime bindings. */
export function database(env: Pick<RuntimeEnv, 'DB'>) {
  return drizzle(env.DB, { schema });
}

/** Inspect wrapped driver errors without losing SQLite trigger/constraint classifications. */
export function databaseErrorIncludes(error: unknown, marker: string): boolean {
  const seen = new Set<unknown>();
  while (error && !seen.has(error)) {
    seen.add(error);
    if (String(error).includes(marker)) return true;
    error = error instanceof Error ? error.cause : undefined;
  }
  return false;
}
