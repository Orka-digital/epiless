import { describe, expect, it } from 'vitest';

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join, resolve } from 'node:path';

import { execFileSync } from 'node:child_process';

import {
  locallyEligibleRules,
  publicRuleSchema,
  verifyManifest,
  verifyRulesPayload,
  type SignedManifest,
} from '../src/index.js';
import {
  build,
  example,
  expiresAt,
  generatedAt,
  now,
  trust,
} from './feed.fixture';
describe('signed public feed', () => {
  it('makes authenticated revocations available even if the rule download fails', async () => {
    const built = await build({ revokedRuleIds: [example.id], sequence: 43 });
    const verified = await verifyManifest(
      built.signedManifest,
      trust({ highestSequence: 42 }),
    );
    const persistedRevocations = new Set(verified.manifest.revokedRuleIds);
    await expect(
      verifyRulesPayload(new Uint8Array(), verified),
    ).rejects.toThrow();
    expect(
      locallyEligibleRules([example], {
        now,
        revokedRuleIds: persistedRevocations,
        disabledRuleIds: new Set(),
      }),
    ).toEqual([]);
    await expect(
      build({ rules: [example], revokedRuleIds: [example.id] }),
    ).rejects.toThrow('revoked');
  });

  it('retains offline rules through stale metadata but honors hard expiry and local disable', () => {
    const later = now + 60 * 86_400_000;
    const options = {
      now: later,
      revokedRuleIds: new Set<string>(),
      disabledRuleIds: new Set<string>(),
    };
    expect(locallyEligibleRules([example], options)).toEqual([example]);
    expect(
      locallyEligibleRules([{ ...example, notAfter: expiresAt }], options),
    ).toEqual([]);
    expect(
      locallyEligibleRules([{ ...example, notAfter: expiresAt }], {
        ...options,
        now,
        lastTrustedTime: later,
      }),
    ).toEqual([]);
    expect(
      locallyEligibleRules([example], {
        ...options,
        disabledRuleIds: new Set([example.id]),
      }),
    ).toEqual([]);
  });

  it('rejects unreviewed/unknown rules and injected remote code or query information', async () => {
    for (const change of [
      { execute: 'alert(1)' },
      { selector: 'video,body' },
      { selector: '*:has(*)' },
      { action: 'RUN_SCRIPT' },
      { origin: 'https://fixture.example?email=secret' },
      { path: '/demo?token=secret' },
      { review: { ...example.review, status: 'NEEDS_REVIEW' } },
    ])
      expect(
        publicRuleSchema.safeParse({ ...example, ...change }).success,
      ).toBe(false);
    await expect(build({ rules: [example, example] })).rejects.toThrow(
      'Duplicate',
    );
    await expect(
      build({ rules: [{ ...example, notAfter: generatedAt }] }),
    ).rejects.toThrow('Expired');
  });

  it('builds and verifies a CLI artifact with no persistent private key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flashguard-feed-test-'));
    try {
      execFileSync(
        process.execPath,
        [
          '--import',
          'tsx',
          resolve('packages/rule-feed/src/cli.ts'),
          '--rules',
          resolve('packages/rule-feed/fixtures/empty-rules.json'),
          '--out',
          directory,
          '--sequence',
          '1',
          '--key-id',
          'local-test',
          '--dev-key',
          '--generated-at',
          generatedAt,
          '--expires-at',
          expiresAt,
        ],
        { cwd: process.cwd(), encoding: 'utf8' },
      );
      const trustFile = JSON.parse(
        await readFile(join(directory, 'trusted-public-key.json'), 'utf8'),
      );
      const envelope: SignedManifest = JSON.parse(
        await readFile(join(directory, 'feeds/stable/latest.json'), 'utf8'),
      );
      const metadata = await verifyManifest(
        envelope,
        trust({ trustedKeys: { 'local-test': trustFile.publicKey } }),
      );
      const bytes = new Uint8Array(
        await readFile(join(directory, metadata.manifest.files[0].path)),
      );
      expect(await verifyRulesPayload(bytes, metadata)).toEqual([]);
      expect(trustFile.developmentOnly).toBe(true);
      expect(trustFile.publicKey.d).toBeUndefined();
      expect((await readdir(directory)).sort()).toEqual([
        'feeds',
        'trusted-public-key.json',
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
