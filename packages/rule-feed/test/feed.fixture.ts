import { beforeAll } from 'vitest';

import {
  buildSignedFeed,
  verifyManifest,
  type PublicRule,
} from '../src/index.js';

export const now = Date.parse('2026-10-26T12:00:00Z');

export const generatedAt = '2026-10-26T12:00:00Z';

export const expiresAt = '2026-11-02T12:00:00Z';

let signingKey: CryptoKey;

let publicKey: JsonWebKey;

export const example: PublicRule = {
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

export const build = (
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

export const trust = (
  overrides: Partial<Parameters<typeof verifyManifest>[1]> = {},
) => ({
  trustedKeys: { test: publicKey },
  now,
  extensionVersion: '0.1.0',
  ...overrides,
});
