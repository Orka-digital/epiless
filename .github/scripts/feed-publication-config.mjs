import { execFile } from 'node:child_process';

import { promisify } from 'node:util';

import { createPrivateKey } from 'node:crypto';

const execute = promisify(execFile);

const required = (/** @type {string} */ name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing protected feed configuration: ${name}`);
  return value;
};

/** Validate protected feed bindings before opening publication files or making network requests. */
export async function publicationConfiguration() {
  const account = required('CLOUDFLARE_ACCOUNT_ID');
  const bucket = required('FEED_BUCKET');
  if (
    !/^[a-f0-9]{32}$/.test(account) ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)
  )
    throw new Error('Invalid R2 account or bucket');
  required('AWS_ACCESS_KEY_ID');
  required('AWS_SECRET_ACCESS_KEY');
  const cdn = new URL(required('FEED_CDN_ORIGIN'));
  if (
    cdn.protocol !== 'https:' ||
    cdn.pathname !== '/' ||
    cdn.search ||
    cdn.hash ||
    cdn.username ||
    cdn.password
  )
    throw new Error('Feed CDN must be an exact HTTPS origin');
  const expected = Number(required('EXPECTED_SEQUENCE'));
  if (
    !Number.isSafeInteger(expected) ||
    expected < 1 ||
    expected >= Number.MAX_SAFE_INTEGER
  )
    throw new Error(
      'Expected sequence must identify an existing signed release; bootstrap is a separate operation',
    );
  const trustedKeys = JSON.parse(required('FEED_TRUSTED_KEYS').toString());
  const keyId = required('FEED_SIGNING_KEY_ID');
  const privateJwk = createPrivateKey(
    required('FEED_SIGNING_PRIVATE_KEY'),
  ).export({ format: 'jwk' });
  const signingKey = await crypto.subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  const endpoint = `https://${account}.r2.cloudflarestorage.com`;
  const aws = async (/** @type {string[]} */ args) => {
    const result = await execute(
      'aws',
      [
        '--endpoint-url',
        endpoint,
        '--region',
        'auto',
        '--no-cli-pager',
        ...args,
      ],
      {
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          AWS_REQUEST_CHECKSUM_CALCULATION: 'when_required',
          AWS_RESPONSE_CHECKSUM_VALIDATION: 'when_required',
        },
      },
    );
    return result.stdout.trim() ? JSON.parse(result.stdout.toString()) : {};
  };
  return { bucket, cdn, expected, trustedKeys, keyId, signingKey, aws };
}
