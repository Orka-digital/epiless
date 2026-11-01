import { describe, expect, it } from 'vitest';

import { sha256Bytes, stableJson } from '@epi-less/core';

import { verifyManifest, verifyRulesPayload } from '../src/index.js';
import { build, example, expiresAt, now, trust } from './feed.fixture';
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
});
