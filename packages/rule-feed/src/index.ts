import { z } from 'zod';
import { sha256Bytes, stableJson } from '@epi-less/core';

export const MAX_MANIFEST_BYTES = 64 * 1024;
export const MAX_RULE_BYTES = 8 * 1024 * 1024;
const domain = new TextEncoder().encode('FlashGuard rule feed v1\n');
const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const version = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  .max(40);
const timestamp = z.iso.datetime({ offset: true });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const simpleSelector =
  /^(?:[a-zA-Z][\w-]*|[.#][a-zA-Z_][\w-]*)(?:[.#][a-zA-Z_][\w-]*)*(?:\s*>\s*(?:[a-zA-Z][\w-]*|[.#][a-zA-Z_][\w-]*)(?:[.#][a-zA-Z_][\w-]*)*)*$/;

export const publicRuleSchema = z.strictObject({
  id: identifier,
  origin: z
    .url()
    .max(2048)
    .refine((value) => {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
    }, 'Expected an exact HTTP(S) origin'),
  path: z
    .string()
    .min(1)
    .max(1024)
    .refine((value) => {
      try {
        return (
          value.startsWith('/') &&
          !value.startsWith('//') &&
          new URL(value, 'https://example.invalid').pathname === value &&
          !/[?#\s]/.test(value)
        );
      } catch {
        return false;
      }
    }, 'Expected an exact path without query, fragment or normalization ambiguity'),
  selector: z
    .string()
    .min(1)
    .max(256)
    .regex(
      simpleSelector,
      'Only simple type/class/id selectors and child combinators are supported',
    ),
  action: z.enum(['PAUSE_MEDIA', 'HIDE_ELEMENT', 'REDUCE_MOTION']),
  fingerprint: z.strictObject({ version: z.literal(1), sha256: hash }),
  review: z.strictObject({
    status: z.literal('APPROVED'),
    reviewedAt: timestamp,
    sourceReportId: identifier,
  }),
  notAfter: timestamp.optional(),
});
export type PublicRule = z.infer<typeof publicRuleSchema>;

export const rulePayloadSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    rules: z.array(publicRuleSchema).max(20_000),
  })
  .superRefine((payload, context) => {
    const ids = new Set<string>();
    for (const rule of payload.rules) {
      if (ids.has(rule.id))
        context.addIssue({ code: 'custom', message: 'Duplicate rule id' });
      ids.add(rule.id);
    }
  });
export const manifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    channel: z.literal('stable'),
    keyId: identifier,
    sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    generatedAt: timestamp,
    expiresAt: timestamp,
    minExtensionVersion: version,
    ruleSchemaVersion: z.literal(1),
    fingerprintVersion: z.literal(1),
    files: z
      .array(
        z.strictObject({
          path: z
            .string()
            .regex(
              /^feeds\/stable\/releases\/\d{6,16}\/rules\.[a-f0-9]{64}\.json$/,
            ),
          bytes: z.number().int().positive().max(MAX_RULE_BYTES),
          sha256: hash,
        }),
      )
      .length(1),
    revokedRuleIds: z.array(identifier).max(20_000),
  })
  .superRefine((manifest, context) => {
    const generatedAt = Date.parse(manifest.generatedAt);
    const expiresAt = Date.parse(manifest.expiresAt);
    if (expiresAt <= generatedAt || expiresAt - generatedAt > 7 * 86_400_000)
      context.addIssue({
        code: 'custom',
        message: 'Metadata lifetime must be positive and at most seven days',
      });
    if (
      new Set(manifest.revokedRuleIds).size !== manifest.revokedRuleIds.length
    )
      context.addIssue({ code: 'custom', message: 'Duplicate revocation id' });
    const file = manifest.files[0];
    if (
      file.path !==
      `feeds/stable/releases/${String(manifest.sequence).padStart(6, '0')}/rules.${file.sha256}.json`
    )
      context.addIssue({
        code: 'custom',
        message: 'File path must bind the sequence and content hash',
      });
  });
export type FeedManifest = z.infer<typeof manifestSchema>;
export const signedManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  algorithm: z.literal('Ed25519'),
  keyId: identifier,
  payload: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .max(MAX_MANIFEST_BYTES),
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});
export type SignedManifest = z.infer<typeof signedManifestSchema>;

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function decodeBase64Url(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (encodeBase64Url(bytes) !== value)
    throw new Error('Non-canonical base64url');
  return bytes;
}
function signedBytes(payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(domain.length + payload.length);
  bytes.set(domain);
  bytes.set(payload, domain.length);
  return bytes;
}
function parseCanonicalJson(bytes: Uint8Array): unknown {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const json: unknown = JSON.parse(text);
  if (stableJson(json) !== text)
    throw new Error(
      'Feed payload must use the specified canonical JSON encoding',
    );
  return json;
}
function compareVersions(left: string, right: string): number {
  const a = version.parse(left).split('.').map(BigInt);
  const b = version.parse(right).split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

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
