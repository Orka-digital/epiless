import type { AuditReport } from '@epi-less/core';
import { afterEach, beforeEach } from 'vitest';
import {
  commitPublication,
  createIntent,
  verifyIntent,
} from '../../apps/web/src/server/publications';
import type { RuntimeEnv } from '../../apps/web/src/server/types';
import { testDatabase } from './database';
export const report: AuditReport = {
  schemaVersion: 1,
  id: 'test-audit',
  origin: 'https://example.com',
  startedAt: '2026-10-26T10:00:00Z',
  endedAt: '2026-10-26T10:01:00Z',
  engineVersion: '0.1.0',
  runnerVersion: '0.1.0',
  status: 'INCONCLUSIVE',
  passed: null,
  job: {
    state: 'PARTIAL',
    stopReason: 'BUDGET_REACHED',
    maxRoutes: 50,
    maxDepth: 4,
    maxDurationMs: 1200000,
    discoveredRoutes: 2,
    visitedRoutes: 1,
  },
  routes: [
    {
      url: 'https://example.com/',
      status: 'PARTIAL',
      reason: 'Fixture',
      scenarios: [],
    },
  ],
  limitations: ['Synthetic fixture; no actual scan.'],
};
export let fixture: ReturnType<typeof testDatabase>;
export let env: RuntimeEnv;
export let request: Request;
beforeEach(() => {
  fixture = testDatabase();
  env = {
    DB: fixture.db,
    ENVIRONMENT: 'development',
    PUBLIC_APP_ORIGIN: 'http://localhost:4321',
    BETTER_AUTH_SECRET: 'test-auth-secret-long-enough-for-32-characters',
    SHARE_TOKEN_SECRET: 'test-share-secret-long-enough-for-32-characters',
    TURNSTILE_SITE_KEY: 'local',
    LOCAL_TURNSTILE_FIXTURE: 'true',
  };
  request = new Request('http://localhost:4321/api/publications', {
    method: 'POST',
    headers: {
      Origin: env.PUBLIC_APP_ORIGIN,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  for (const id of ['alice', 'bob', 'moderator'])
    fixture.sqlite
      .prepare(
        'INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES(?,?,?,?,?)',
      )
      .run(id, id, `${id}@example.com`, Date.now(), Date.now());
});
afterEach(() => fixture.sqlite.close());

export async function publish(
  visibility: 'PUBLIC' | 'PRIVATE' | 'UNLISTED' = 'PUBLIC',
  key = crypto.randomUUID(),
) {
  const intent = await createIntent(env, request, 'alice', {
    report,
    visibility,
    idempotencyKey: key,
  });
  if (intent.challenge)
    await verifyIntent(env, request, 'alice', intent.id, {
      challengeId: intent.challenge.id,
      token: 'flashguard-local-test',
    });
  const publication = await commitPublication(env, 'alice', intent.id);
  return { intent, publication, key };
}
