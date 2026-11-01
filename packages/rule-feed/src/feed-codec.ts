import { stableJson } from '@epi-less/core';
import { version } from './feed-schema.js';

const domain = new TextEncoder().encode('FlashGuard rule feed v1\n');

/** Encode exact bytes as unpadded base64url. */
export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Decode bounded base64url bytes; malformed encoding throws. */
export function decodeBase64Url(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (encodeBase64Url(bytes) !== value)
    throw new Error('Non-canonical base64url');
  return bytes;
}

/** Prefix canonical payload bytes with the feed signature domain. */
export function signedBytes(payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(domain.length + payload.length);
  bytes.set(domain);
  bytes.set(payload, domain.length);
  return bytes;
}

/** Parse UTF-8 JSON and reject noncanonical serialization. */
export function parseCanonicalJson(bytes: Uint8Array): unknown {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const json: unknown = JSON.parse(text);
  if (stableJson(json) !== text)
    throw new Error(
      'Feed payload must use the specified canonical JSON encoding',
    );
  return json;
}

/** Compare validated numeric semantic versions without lexical ordering. */
export function compareVersions(left: string, right: string): number {
  const a = version.parse(left).split('.').map(BigInt);
  const b = version.parse(right).split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}
