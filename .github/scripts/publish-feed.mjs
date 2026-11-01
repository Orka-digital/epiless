import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import {
  buildSignedFeed,
  rulePayloadSchema,
  verifyManifest,
  verifyRulesPayload,
} from '../../packages/rule-feed/src/index.ts';

import { sha256Bytes } from '../../packages/core/src/index.ts';
import { publicationConfiguration } from './feed-publication-config.mjs';

async function main() {
  const { bucket, cdn, expected, trustedKeys, keyId, signingKey, aws } =
    await publicationConfiguration();
  const directory = await mkdtemp(join(tmpdir(), 'flashguard-publish-'));
  try {
    const previousPath = join(directory, 'previous.json');
    const previousObject = await aws([
      's3api',
      'get-object',
      '--bucket',
      bucket,
      '--key',
      'feeds/stable/latest.json',
      previousPath,
    ]);
    if (typeof previousObject.ETag !== 'string')
      throw new Error(
        'The previous object needs an ETag for conditional publication',
      );
    const previousEnvelope = JSON.parse(
      (await readFile(previousPath, 'utf8')).toString(),
    );
    const claimedPayload = JSON.parse(
      Buffer.from(previousEnvelope.payload, 'base64url')
        .toString('utf8')
        .toString(),
    );
    // Prior metadata is authenticated as historical state, not accepted as a fresh client update.
    // This permits recovery after metadata expired without weakening the client verifier.
    const previous = await verifyManifest(previousEnvelope, {
      trustedKeys,
      now: Date.parse(claimedPayload.generatedAt),
      extensionVersion: claimedPayload.minExtensionVersion,
      minimumSequence: expected,
    });
    if (previous.manifest.sequence !== expected)
      throw new Error(
        'R2 sequence changed; review the latest release and retry with its exact sequence',
      );
    const { rules } = rulePayloadSchema.parse(
      JSON.parse(
        (
          await readFile('packages/rule-feed/approved/rules.json', 'utf8')
        ).toString(),
      ),
    );
    const newRevocations = JSON.parse(
      (
        await readFile('packages/rule-feed/approved/revocations.json', 'utf8')
      ).toString(),
    );
    if (
      !Array.isArray(newRevocations) ||
      newRevocations.some((value) => typeof value !== 'string')
    )
      throw new Error('Invalid reviewed revocation list');
    const revokedRuleIds = [
      ...new Set([...previous.manifest.revokedRuleIds, ...newRevocations]),
    ];
    const generatedAt = process.env.GENERATED_AT || new Date().toISOString();
    console.log(
      `Building sequence ${expected + 1}; generated_at=${generatedAt}; approved rules=${rules.length}.`,
    );
    const built = await buildSignedFeed({
      rules,
      revokedRuleIds,
      sequence: expected + 1,
      generatedAt,
      expiresAt: new Date(
        Date.parse(generatedAt) + 7 * 86_400_000,
      ).toISOString(),
      keyId,
      signingKey,
    });
    const verified = await verifyManifest(built.signedManifest, {
      trustedKeys,
      now: Date.now(),
      extensionVersion: '0.1.0',
      highestSequence: expected,
      highestPayloadHash: previous.payloadHash,
    });
    await verifyRulesPayload(built.rulesBytes, verified);
    const ruleFile = join(directory, 'rules.json');
    const manifestFile = join(directory, 'manifest.json');
    await writeFile(ruleFile, built.rulesBytes);
    await writeFile(manifestFile, built.manifestBytes);
    const putImmutable = async (
      /** @type {string} */ key,
      /** @type {string} */ filename,
      /** @type {Uint8Array} */ expectedBytes,
    ) => {
      try {
        await aws([
          's3api',
          'put-object',
          '--bucket',
          bucket,
          '--key',
          key,
          '--body',
          filename,
          '--content-type',
          'application/json',
          '--cache-control',
          'public, max-age=31536000, immutable',
          '--if-none-match',
          '*',
        ]);
      } catch (error) {
        // A retry may reuse existing immutable bytes, but never overwrite them.
        if (
          !String(
            error && typeof error === 'object' && 'stderr' in error
              ? error.stderr
              : '',
          ).includes('PreconditionFailed')
        )
          throw error;
      }
      const checkPath = join(directory, 'verify-object.json');
      await aws([
        's3api',
        'get-object',
        '--bucket',
        bucket,
        '--key',
        key,
        checkPath,
      ]);
      const remote = new Uint8Array(await readFile(checkPath));
      if ((await sha256Bytes(remote)) !== (await sha256Bytes(expectedBytes)))
        throw new Error(
          'Immutable object differs; stop and investigate the partial release',
        );
      const response = await fetch(new URL(key, cdn), {
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
      if (!response.ok || !response.body)
        throw new Error(
          'CDN immutable object verification failed; latest was not changed',
        );
      const reader = response.body.getReader();
      const downloaded = new Uint8Array(expectedBytes.length);
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (received + value.length > expectedBytes.length) {
          await reader.cancel();
          throw new Error(
            'CDN response exceeded the expected decoded-byte size',
          );
        }
        downloaded.set(value, received);
        received += value.length;
      }
      if (
        received !== expectedBytes.length ||
        (await sha256Bytes(downloaded)) !== (await sha256Bytes(expectedBytes))
      )
        throw new Error(
          'CDN immutable object verification failed; latest was not changed',
        );
    };
    await putImmutable(
      built.manifest.files[0].path,
      ruleFile,
      built.rulesBytes,
    );
    await putImmutable(
      `${built.releaseDirectory}/manifest.json`,
      manifestFile,
      built.manifestBytes,
    );
    await aws([
      's3api',
      'put-object',
      '--bucket',
      bucket,
      '--key',
      'feeds/stable/latest.json',
      '--body',
      manifestFile,
      '--content-type',
      'application/json',
      '--cache-control',
      'public, max-age=300, stale-while-revalidate=3600, stale-if-error=86400',
      '--if-match',
      previousObject.ETag,
    ]);
    const checkLatest = join(directory, 'latest-check.json');
    await aws([
      's3api',
      'get-object',
      '--bucket',
      bucket,
      '--key',
      'feeds/stable/latest.json',
      checkLatest,
    ]);
    if (
      (await sha256Bytes(new Uint8Array(await readFile(checkLatest)))) !==
      (await sha256Bytes(built.manifestBytes))
    )
      throw new Error('Post-publication R2 verification failed');
    console.log(
      `Published signed sequence ${built.manifest.sequence}. CDN latest may retain its previous cache entry until revalidation. A zero-rule feed provides no blocking coverage.`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  // Subprocess exception strings can include input; report only the public failure message.
  console.error(
    error?.stderr
      ? 'R2 command failed; publication was stopped. Inspect provider status and scoped credentials.'
      : error instanceof Error
        ? error instanceof Error
          ? error.message
          : String(error)
        : 'Feed publication failed',
  );
  process.exitCode = 1;
});
