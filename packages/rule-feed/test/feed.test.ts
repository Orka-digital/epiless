import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { sha256Bytes, stableJson } from '@epi-less/core';
import {
  buildSignedFeed,
  locallyEligibleRules,
  publicRuleSchema,
  verifyManifest,
  verifyRulesPayload,
  type PublicRule,
  type SignedManifest,
} from '../src/index.js';

const now = Date.parse('2026-10-26T12:00:00Z');
const generatedAt = '2026-10-26T12:00:00Z';
const expiresAt = '2026-11-02T12:00:00Z';
let signingKey: CryptoKey;
let publicKey: JsonWebKey;
const example: PublicRule = {
  id: 'synthetic-reviewed-rule',
  origin: 'https://fixture.example',
  path: '/demo',
  selector: '#demo > video',
  action: 'PAUSE_MEDIA',
  fingerprint: { version: 1, sha256: 'a'.repeat(64) },
  review: {
    status: 'APPROVED',
    reviewedAt: '2026-10-25T12:00:00Z',
    sourceReportId: 'synthetic-public-report',
  },
};
beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  signingKey = pair.privateKey;
  publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
});
const build = (
  overrides: Partial<Parameters<typeof buildSignedFeed>[0]> = {},
) =>
  buildSignedFeed({
    rules: [],
    sequence: 42,
    generatedAt,
    expiresAt,
    keyId: 'test',
    signingKey,
    ...overrides,
  });
const trust = (
  overrides: Partial<Parameters<typeof verifyManifest>[1]> = {},
) => ({
  trustedKeys: { test: publicKey },
  now,
  extensionVersion: '0.1.0',
  ...overrides,
});

describe('signed public feed', () => {
  it('verifies the public RFC 8032 Ed25519 vector independently of our signer', async () => {
    const hex = (value: string) =>
      Uint8Array.from(value.match(/../g)!, (pair) => Number.parseInt(pair, 16));
    // RFC 8032 section 7.1, test 1: public key/signature only; no private signing secret.
    const publicBytes = hex(
      'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    );
    const signature = hex(
      'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
    );
    const key = await crypto.subtle.importKey(
      'raw',
      publicBytes,
      'Ed25519',
      false,
      ['verify'],
    );
    expect(
      await crypto.subtle.verify('Ed25519', key, signature, new Uint8Array()),
    ).toBe(true);
    expect(
      await crypto.subtle.verify(
        'Ed25519',
        key,
        signature,
        new Uint8Array([1]),
      ),
    ).toBe(false);
  });
  it('builds a deterministic explicitly empty feed and hashes the exact file bytes', async () => {
    const first = await build();
    const second = await build();
    expect(first.manifestBytes).toEqual(second.manifestBytes);
    expect(new TextDecoder().decode(first.rulesBytes)).toBe(
      '{"rules":[],"schemaVersion":1}',
    );
    expect(first.manifest.files[0].sha256).toBe(
      await sha256Bytes(first.rulesBytes),
    );
    const metadata = await verifyManifest(first.signedManifest, trust());
    expect(await verifyRulesPayload(first.rulesBytes, metadata)).toEqual([]);
  });
  it('sorts reviewed rules and binds all manifest fields to the signature', async () => {
    const first = await build({ rules: [{ ...example, id: 'z' }, example] });
    const second = await build({ rules: [example, { ...example, id: 'z' }] });
    expect(first.manifestBytes).toEqual(second.manifestBytes);
    const altered = structuredClone(first.signedManifest);
    const payload = JSON.parse(
      Buffer.from(altered.payload, 'base64url').toString(),
    );
    payload.sequence = 43;
    altered.payload = Buffer.from(stableJson(payload)).toString('base64url');
    await expect(verifyManifest(altered, trust())).rejects.toThrow('signature');
  });
  it('rejects unknown keys, extra fields and the wrong signature primitive', async () => {
    const built = await build();
    await expect(
      verifyManifest(
        { ...built.signedManifest, keyId: 'not-trusted' },
        trust(),
      ),
    ).rejects.toThrow('Unknown');
    await expect(
      verifyManifest({ ...built.signedManifest, ignored: true }, trust()),
    ).rejects.toThrow();
    await expect(
      verifyManifest({ ...built.signedManifest, algorithm: 'RSA' }, trust()),
    ).rejects.toThrow();
    const stranger = (await crypto.subtle.generateKey('Ed25519', true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    await expect(
      verifyManifest(
        built.signedManifest,
        trust({
          trustedKeys: {
            test: await crypto.subtle.exportKey('jwk', stranger.publicKey),
          },
        }),
      ),
    ).rejects.toThrow('signature');
  });
  it('rejects downgrade and same-version equivocation, and allows exact resumable metadata', async () => {
    const built = await build();
    const verified = await verifyManifest(built.signedManifest, trust());
    await expect(
      verifyManifest(built.signedManifest, trust({ highestSequence: 43 })),
    ).rejects.toThrow('rollback');
    await expect(
      verifyManifest(built.signedManifest, trust({ minimumSequence: 43 })),
    ).rejects.toThrow('rollback');
    await expect(
      verifyManifest(built.signedManifest, trust({ highestSequence: 42 })),
    ).rejects.toThrow('reused');
    await expect(
      verifyManifest(
        built.signedManifest,
        trust({
          highestSequence: 42,
          highestPayloadHash: verified.payloadHash,
        }),
      ),
    ).resolves.toEqual(verified);
    const changed = await build({ revokedRuleIds: ['withdrawn-rule'] });
    await expect(
      verifyManifest(
        changed.signedManifest,
        trust({
          highestSequence: 42,
          highestPayloadHash: verified.payloadHash,
        }),
      ),
    ).rejects.toThrow('reused');
    const corrected = await build({ sequence: 43 });
    await expect(
      verifyManifest(
        corrected.signedManifest,
        trust({
          highestSequence: 42,
          highestPayloadHash: verified.payloadHash,
        }),
      ),
    ).resolves.toMatchObject({ manifest: { sequence: 43 } });
  });
  it('rejects expired new metadata, future releases, backward clocks and incompatible clients', async () => {
    const built = await build();
    await expect(
      verifyManifest(
        built.signedManifest,
        trust({ now: Date.parse(expiresAt) }),
      ),
    ).rejects.toThrow('expired');
    await expect(
      verifyManifest(built.signedManifest, trust({ now: now - 6 * 60_000 })),
    ).rejects.toThrow('future');
    await expect(
      verifyManifest(built.signedManifest, trust({ lastTrustedTime: now + 1 })),
    ).rejects.toThrow('Clock');
    await expect(
      verifyManifest(
        built.signedManifest,
        trust({ extensionVersion: '0.0.9' }),
      ),
    ).rejects.toThrow('compatible');
    await expect(
      build({ expiresAt: '2026-11-03T12:00:00Z' }),
    ).rejects.toThrow();
  });
  it('rejects exact-length corrupt file bytes and parse-equivalent reformatted bytes', async () => {
    const built = await build();
    const verified = await verifyManifest(built.signedManifest, trust());
    const corrupt = new Uint8Array(built.rulesBytes);
    corrupt[0] = 91;
    await expect(verifyRulesPayload(corrupt, verified)).rejects.toThrow('hash');
    const reformatted = new TextEncoder().encode(
      new TextDecoder().decode(built.rulesBytes) + '\n',
    );
    await expect(verifyRulesPayload(reformatted, verified)).rejects.toThrow(
      'size',
    );
  });
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
