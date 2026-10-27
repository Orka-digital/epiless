import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import {
  feedServer,
  LATEST_CACHE,
  IMMUTABLE_CACHE,
} from '../../../scripts/serve-feed.mjs';
import {
  buildSignedFeed,
  verifyManifest,
  verifyRulesPayload,
} from '../src/index';
it('serves a signed static release without the app/API/database and supports conditional cache requests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'epiless-static-feed-'));
  const keys = (await crypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const release = await buildSignedFeed({
    rules: [],
    revokedRuleIds: [],
    sequence: 1,
    keyId: 'test',
    signingKey: keys.privateKey,
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  for (const [path, bytes] of [
    ['feeds/stable/latest.json', release.manifestBytes],
    [release.manifest.files[0].path, release.rulesBytes],
  ] as const) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), bytes);
  }
  const server = feedServer(directory);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(`${origin}/feeds/stable/latest.json`);
    expect(response.headers.get('cache-control')).toBe(LATEST_CACHE);
    expect(response.headers.get('set-cookie')).toBeNull();
    const verified = await verifyManifest(await response.json(), {
      trustedKeys: { test: publicKey },
      now: Date.now(),
      extensionVersion: '0.1.0',
    });
    const payload = await fetch(`${origin}/${verified.manifest.files[0].path}`);
    expect(payload.headers.get('cache-control')).toBe(IMMUTABLE_CACHE);
    expect(
      await verifyRulesPayload(
        new Uint8Array(await payload.arrayBuffer()),
        verified,
      ),
    ).toEqual([]);
    expect(
      (
        await fetch(`${origin}/feeds/stable/latest.json`, {
          headers: { 'If-None-Match': response.headers.get('etag')! },
        })
      ).status,
    ).toBe(304);
    for (const path of [
      '/api/index',
      '/trusted-public-key.json',
      '/.env',
      '/feeds/stable/releases/000001/../../secret.json',
    ])
      expect((await fetch(`${origin}${path}`)).status).toBe(404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
