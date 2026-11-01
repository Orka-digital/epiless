import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createPrivateKey } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  buildSignedFeed,
  rulePayloadSchema,
  verifyManifest,
  verifyRulesPayload,
} from './index.js';
import { stableJson } from '@epi-less/core';

const { values } = parseArgs({
  options: {
    rules: { type: 'string' },
    out: { type: 'string' },
    sequence: { type: 'string' },
    'key-file': { type: 'string' },
    'key-id': { type: 'string' },
    'dev-key': { type: 'boolean' },
    'generated-at': { type: 'string' },
    'expires-at': { type: 'string' },
    'min-extension-version': { type: 'string' },
    revocations: { type: 'string' },
  },
  strict: true,
});

async function main(): Promise<void> {
  if (!values.rules || !values.out || !values.sequence || !values['key-id'])
    throw new Error(
      'Required: --rules FILE --out DIR --sequence N --key-id ID, and either --key-file PEM or --dev-key',
    );
  if (Boolean(values['key-file']) === Boolean(values['dev-key']))
    throw new Error(
      'Provide exactly one of --key-file or --dev-key (local verification only)',
    );
  const { rules } = rulePayloadSchema.parse(
    JSON.parse(await readFile(values.rules, 'utf8')),
  );
  let signingKey: CryptoKey;
  let publicKey: JsonWebKey;
  if (values['dev-key']) {
    const pair = await crypto.subtle.generateKey('Ed25519', true, [
      'sign',
      'verify',
    ]);
    signingKey = pair.privateKey;
    publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
  } else {
    const privateJwk = createPrivateKey(
      await readFile(values['key-file']!, 'utf8'),
    ).export({ format: 'jwk' });
    signingKey = await crypto.subtle.importKey(
      'jwk',
      privateJwk,
      { name: 'Ed25519' },
      false,
      ['sign'],
    );
    publicKey = {
      kty: privateJwk.kty,
      crv: privateJwk.crv,
      x: privateJwk.x,
      key_ops: ['verify'],
      ext: true,
    };
  }
  const generatedAt = values['generated-at'] ?? new Date().toISOString();
  const expiresAt =
    values['expires-at'] ??
    new Date(Date.parse(generatedAt) + 7 * 86_400_000).toISOString();
  const revocations: string[] = values.revocations
    ? JSON.parse(await readFile(values.revocations, 'utf8'))
    : [];
  if (
    !Array.isArray(revocations) ||
    revocations.some((id) => typeof id !== 'string')
  )
    throw new Error('Revocations must be an array of rule IDs');
  const built = await buildSignedFeed({
    rules,
    sequence: Number(values.sequence),
    generatedAt,
    expiresAt,
    minExtensionVersion: values['min-extension-version'],
    keyId: values['key-id'],
    signingKey,
    revokedRuleIds: revocations,
  });
  const verified = await verifyManifest(built.signedManifest, {
    trustedKeys: { [values['key-id']]: publicKey },
    now: Date.parse(generatedAt),
    extensionVersion: values['min-extension-version'] ?? '0.1.0',
  });
  await verifyRulesPayload(built.rulesBytes, verified);
  const output = resolve(values.out);
  const write = async (
    path: string,
    bytes: Uint8Array | string,
  ): Promise<void> => {
    const destination = resolve(output, path);
    if (!destination.startsWith(output + '/'))
      throw new Error('Output path escaped the release directory');
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: 'wx' });
  };
  await write(built.manifest.files[0].path, built.rulesBytes);
  await write(`${built.releaseDirectory}/manifest.json`, built.manifestBytes);
  // Last file only after the full release has been built and self-verified.
  // Upload/publication to a CDN is a separate protected operation.
  await write('feeds/stable/latest.json', built.manifestBytes);
  await write(
    'trusted-public-key.json',
    stableJson({
      keyId: values['key-id'],
      publicKey,
      developmentOnly: Boolean(values['dev-key']),
    }),
  );
  process.stdout.write(
    `Verified ${rules.length} approved rules; sequence ${built.manifest.sequence}. Output: ${output}\n`,
  );
  if (values['dev-key'])
    process.stdout.write(
      'Development key was generated in memory and discarded. This release is not trusted by production clients.\n',
    );
}

main().catch((error) => {
  process.stderr.write(
    `Feed build failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
