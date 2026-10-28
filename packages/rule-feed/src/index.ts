import { sha256Bytes, stableJson } from '@epi-less/core';
import {
  compareVersions,
  decodeBase64Url,
  parseCanonicalJson,
  signedBytes,
} from './feed-codec.js';
import {
  type FeedManifest,
  manifestSchema,
  MAX_MANIFEST_BYTES,
  MAX_RULE_BYTES,
  type PublicRule,
  rulePayloadSchema,
  signedManifestSchema,
} from './feed-schema.js';

export interface VerifyManifestOptions {
  trustedKeys: Readonly<Record<string, JsonWebKey>>;
  now: number;
  extensionVersion: string;
  highestSequence?: number;
  highestPayloadHash?: string;
  minimumSequence?: number;
  lastTrustedTime?: number;
}

export interface VerifiedManifest {
  manifest: FeedManifest;
  payloadHash: string;
  verifiedAt: number;
}

/**
 * Verifies metadata only. Persist sequence/hash/revocations before the separate file download.
 * The caller supplies a durable trust floor and embedded public keys, never keys from the CDN.
 */
export async function verifyManifest(
  input: unknown,
  options: VerifyManifestOptions,
): Promise<VerifiedManifest> {
  if (!Number.isFinite(options.now) || options.now < 0)
    throw new Error('Invalid verification clock');
  if (
    options.lastTrustedTime !== undefined &&
    options.now < options.lastTrustedTime
  )
    throw new Error('Clock moved behind the last trusted verification');
  if (new TextEncoder().encode(stableJson(input)).length > MAX_MANIFEST_BYTES)
    throw new Error('Manifest exceeds decoded-byte limit');
  const envelope = signedManifestSchema.parse(input);
  const trustedKey = options.trustedKeys[envelope.keyId];
  if (!Object.hasOwn(options.trustedKeys, envelope.keyId) || !trustedKey)
    throw new Error('Unknown signing key');
  if (trustedKey.kty !== 'OKP' || trustedKey.crv !== 'Ed25519' || trustedKey.d)
    throw new Error('Trusted key must be a public Ed25519 key');
  const payloadBytes = decodeBase64Url(envelope.payload);
  const key = await crypto.subtle.importKey(
    'jwk',
    trustedKey,
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  if (
    !(await crypto.subtle.verify(
      'Ed25519',
      key,
      new Uint8Array(decodeBase64Url(envelope.signature)),
      signedBytes(payloadBytes),
    ))
  )
    throw new Error('Invalid manifest signature');
  const manifest = manifestSchema.parse(parseCanonicalJson(payloadBytes));
  if (manifest.keyId !== envelope.keyId)
    throw new Error('Manifest signing-key mismatch');
  const highest = assertSequenceFloor(options, manifest);
  const payloadHash = await sha256Bytes(payloadBytes);
  if (
    manifest.sequence === highest &&
    payloadHash !== options.highestPayloadHash
  )
    throw new Error('Sequence was reused with different or unknown metadata');
  if (Date.parse(manifest.expiresAt) <= options.now)
    throw new Error('New metadata is expired');
  if (Date.parse(manifest.generatedAt) > options.now + 5 * 60_000)
    throw new Error('Metadata is in the future');
  if (
    compareVersions(options.extensionVersion, manifest.minExtensionVersion) < 0
  )
    throw new Error('Extension version is not compatible with this feed');
  return { manifest, payloadHash, verifiedAt: options.now };
}

function assertSequenceFloor(
  options: VerifyManifestOptions,
  manifest: FeedManifest,
) {
  const highest = options.highestSequence ?? 0;
  const minimum = options.minimumSequence ?? 1;
  if (
    ![highest, minimum].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    )
  )
    throw new Error('Invalid sequence trust floor');
  if (manifest.sequence < Math.max(highest, minimum))
    throw new Error('Feed rollback rejected');
  return highest;
}

/** Verifies exact downloaded bytes before parsing. The caller activates only a complete returned set. */
export async function verifyRulesPayload(
  bytes: Uint8Array,
  verified: VerifiedManifest,
): Promise<PublicRule[]> {
  const descriptor = verified.manifest.files[0];
  if (bytes.length !== descriptor.bytes || bytes.length > MAX_RULE_BYTES)
    throw new Error('Rule payload byte size mismatch');
  if ((await sha256Bytes(bytes)) !== descriptor.sha256)
    throw new Error('Rule payload hash mismatch');
  const { rules } = rulePayloadSchema.parse(parseCanonicalJson(bytes));
  const revoked = new Set(verified.manifest.revokedRuleIds);
  if (rules.some((rule) => revoked.has(rule.id)))
    throw new Error('Revoked rule appears in the active payload');
  if (
    rules.some(
      (rule) =>
        Date.parse(rule.review.reviewedAt) >
        Date.parse(verified.manifest.generatedAt),
    )
  )
    throw new Error('Rule review is later than its release');
  return rules;
}

/** Existing verified sets remain usable offline, subject to hard expiry and known local exclusions. */
export function locallyEligibleRules(
  rules: readonly PublicRule[],
  options: {
    now: number;
    lastTrustedTime?: number;
    revokedRuleIds: ReadonlySet<string>;
    disabledRuleIds: ReadonlySet<string>;
  },
): PublicRule[] {
  if (
    !Number.isFinite(options.now) ||
    options.now < 0 ||
    (options.lastTrustedTime !== undefined &&
      (!Number.isFinite(options.lastTrustedTime) ||
        options.lastTrustedTime < 0))
  )
    throw new Error('Invalid local clock');
  const time = Math.max(options.now, options.lastTrustedTime ?? options.now);
  return rules.filter(
    (rule) =>
      !options.revokedRuleIds.has(rule.id) &&
      !options.disabledRuleIds.has(rule.id) &&
      (!rule.notAfter || Date.parse(rule.notAfter) > time),
  );
}
export { buildSignedFeed } from './feed-build.js';
export type { BuildFeedOptions, BuiltFeed } from './feed-build.js';
export {
  manifestSchema,
  MAX_MANIFEST_BYTES,
  MAX_RULE_BYTES,
  publicRuleSchema,
  rulePayloadSchema,
  signedManifestSchema,
} from './feed-schema.js';
export type {
  FeedManifest,
  PublicRule,
  SignedManifest,
} from './feed-schema.js';
