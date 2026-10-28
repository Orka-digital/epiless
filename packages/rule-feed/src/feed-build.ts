import { sha256Bytes, stableJson } from '@epi-less/core';
import { encodeBase64Url, signedBytes } from './feed-codec.js';
import {
  type FeedManifest,
  MAX_MANIFEST_BYTES,
  MAX_RULE_BYTES,
  type PublicRule,
  type SignedManifest,
  manifestSchema,
  rulePayloadSchema,
  signedManifestSchema,
} from './feed-schema.js';

export interface BuildFeedOptions {
  rules: readonly PublicRule[];
  revokedRuleIds?: readonly string[];
  sequence: number;
  generatedAt: string;
  expiresAt: string;
  minExtensionVersion?: string;
  keyId: string;
  signingKey: CryptoKey;
}

export interface BuiltFeed {
  manifest: FeedManifest;
  signedManifest: SignedManifest;
  manifestBytes: Uint8Array;
  rulesBytes: Uint8Array;
  releaseDirectory: string;
}

/** Signing is only a release primitive. It does not automatically promote audit candidates. */
export async function buildSignedFeed(
  options: BuildFeedOptions,
): Promise<BuiltFeed> {
  if (
    options.signingKey.algorithm.name !== 'Ed25519' ||
    options.signingKey.type !== 'private'
  )
    throw new Error('An Ed25519 private signing key is required');
  const payload = rulePayloadSchema.parse({
    schemaVersion: 1,
    rules: [...options.rules].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
  });
  const revocations = [...(options.revokedRuleIds ?? [])].sort();
  const withdrawn = new Set(revocations);
  for (const rule of payload.rules) {
    if (withdrawn.has(rule.id))
      throw new Error('A revoked rule cannot appear in an active release');
    if (Date.parse(rule.review.reviewedAt) > Date.parse(options.generatedAt))
      throw new Error('Rule review must precede the release');
    if (
      rule.notAfter &&
      Date.parse(rule.notAfter) <= Date.parse(options.generatedAt)
    )
      throw new Error('Expired rules cannot be published');
  }
  const rulesBytes = new TextEncoder().encode(stableJson(payload));
  if (rulesBytes.length > MAX_RULE_BYTES)
    throw new Error('Rule payload exceeds the decoded-byte limit');
  const sha256 = await sha256Bytes(rulesBytes);
  const releaseDirectory = `feeds/stable/releases/${String(options.sequence).padStart(6, '0')}`;
  const manifest = manifestSchema.parse({
    schemaVersion: 1,
    channel: 'stable',
    keyId: options.keyId,
    sequence: options.sequence,
    generatedAt: options.generatedAt,
    expiresAt: options.expiresAt,
    minExtensionVersion: options.minExtensionVersion ?? '0.1.0',
    ruleSchemaVersion: 1,
    fingerprintVersion: 1,
    files: [
      {
        path: `${releaseDirectory}/rules.${sha256}.json`,
        bytes: rulesBytes.length,
        sha256,
      },
    ],
    revokedRuleIds: revocations,
  });
  const payloadBytes = new TextEncoder().encode(stableJson(manifest));
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      'Ed25519',
      options.signingKey,
      signedBytes(payloadBytes),
    ),
  );
  const envelope = signedManifestSchema.parse({
    schemaVersion: 1,
    algorithm: 'Ed25519',
    keyId: options.keyId,
    payload: encodeBase64Url(payloadBytes),
    signature: encodeBase64Url(signature),
  });
  const manifestBytes = new TextEncoder().encode(stableJson(envelope));
  if (manifestBytes.length > MAX_MANIFEST_BYTES)
    throw new Error('Signed manifest exceeds the decoded-byte limit');
  return {
    manifest,
    signedManifest: envelope,
    manifestBytes,
    rulesBytes,
    releaseDirectory,
  };
}
