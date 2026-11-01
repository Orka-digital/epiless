import { z } from 'zod';

export const MAX_MANIFEST_BYTES = 64 * 1024;

export const MAX_RULE_BYTES = 8 * 1024 * 1024;

const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);

export const version = z
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
