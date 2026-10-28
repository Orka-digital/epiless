import { expect, it } from 'vitest';
import {
  commitPublication,
  createIntent,
  listSites,
  updatePublication,
} from '../../apps/web/src/server/publications';
import { env, publish, report, request } from './publication-fixture';
it('keeps reads and withdrawals available when the upload budget switch is enabled', async () => {
  const existing = await publish();
  const waiting = await createIntent(env, request, 'alice', {
    report,
    visibility: 'PRIVATE',
    idempotencyKey: crypto.randomUUID(),
  });
  env.UPLOADS_PAUSED = 'true';
  await expect(
    createIntent(env, request, 'alice', {
      report,
      visibility: 'PRIVATE',
      idempotencyKey: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ code: 'UPLOADS_PAUSED', status: 503 });
  await expect(
    commitPublication(env, 'alice', waiting.id),
  ).rejects.toMatchObject({ code: 'UPLOADS_PAUSED' });
  expect((await commitPublication(env, 'alice', existing.intent.id)).id).toBe(
    existing.publication.id,
  );
  expect((await listSites(env)).items).toHaveLength(1);
  await updatePublication(env, 'alice', existing.publication.id, {
    action: 'revoke',
    revision: 1,
  });
  expect((await listSites(env)).items).toHaveLength(0);
});
