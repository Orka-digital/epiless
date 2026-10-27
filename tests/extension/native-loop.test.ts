import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { nativeLoopPage, appendLoopTrace } from './native-loop-page.mjs';
import {
  nativeLoopCadencePage,
  LOOP_CADENCE_POLICY,
} from './native-loop-cadence-page.mjs';
import {
  independentWraps,
  verifyLoopFixtureIdentity,
  verifyNativeLoop,
} from './verify-native-loop.mjs';
import {
  loadNativeEncodedAssets,
  encodedPageSource,
  sha256,
} from './native-encoded-source.mjs';

describe('native loop fixture and evidence verifier (no browser or capture)', () => {
  it('uses only the existing immutable fixed file and generates valid script without starting playback', async () => {
    const assets = await loadNativeEncodedAssets();
    const source = encodedPageSource(assets, true);
    const html = nativeLoopPage(source);
    expect(html).toContain('muted loop playsinline');
    expect(html).toContain('/__native-encoded/fixed.webm');
    expect(html).not.toContain('/__native-encoded/signal.webm');
    expect(html).not.toMatch(/\.play\(|\bautoplay\b|captureStream/);
    expect(
      () => new Function(html.match(/<script>([\s\S]*)<\/script>/)![1]),
    ).not.toThrow();
    expect(() => nativeLoopPage(encodedPageSource(assets, false))).toThrow();
  });
  it('changes only the tiny low-contrast marker period in the opt-in cadence variant', async () => {
    const assets = await loadNativeEncodedAssets();
    const source = encodedPageSource(assets, true);
    const original = nativeLoopPage(source);
    const variant = nativeLoopCadencePage(source);
    expect(variant).toBe(
      original.replace(
        'animation:gentle 20s linear infinite alternate',
        'animation:gentle 2s linear infinite alternate',
      ),
    );
    expect(variant).toContain('width:4px;height:4px;background:#e8e8e8');
    expect(variant).toContain('background:#eee');
    expect(variant).toContain('transform:translateX(180px)');
    expect(variant).not.toMatch(/\.play\(|\bautoplay\b|captureStream/);
    expect(variant).not.toContain('/__native-encoded/signal.webm');
    expect(() =>
      nativeLoopCadencePage(encodedPageSource(assets, false)),
    ).toThrow();
  });
  it('preserves original evidence identity and strictly binds the selected wrapper, policy and HTML', async () => {
    const source = encodedPageSource(await loadNativeEncodedAssets(), true);
    const originalEnvironment = JSON.parse(
      await readFile(
        new URL(
          './evidence/scanner-v04-native-loop-first-environment.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    expect(() =>
      verifyLoopFixtureIdentity(originalEnvironment.loopFixture, source),
    ).not.toThrow();
    const variant = {
      ...originalEnvironment.loopFixture,
      servedHtmlSha256: sha256(nativeLoopCadencePage(source)),
      cadenceVariant: {
        moduleSha256: sha256(
          await readFile(
            new URL('./native-loop-cadence-page.mjs', import.meta.url),
          ),
        ),
        policy: LOOP_CADENCE_POLICY,
      },
    };
    expect(() => verifyLoopFixtureIdentity(variant, source)).not.toThrow();
    for (const changed of [
      { ...variant, cadenceVariant: undefined },
      {
        ...variant,
        servedHtmlSha256: originalEnvironment.loopFixture.servedHtmlSha256,
      },
      {
        ...variant,
        cadenceVariant: {
          ...variant.cadenceVariant,
          moduleSha256: '0'.repeat(64),
        },
      },
      {
        ...variant,
        cadenceVariant: {
          ...variant.cadenceVariant,
          policy: { ...LOOP_CADENCE_POLICY, oneWayDurationMs: 1000 },
        },
      },
    ])
      expect(() => verifyLoopFixtureIdentity(changed, source)).toThrow();
  });
  it('counts only finite sequential end-to-start wraps and rejects seeks, gaps and forged clocks', () => {
    const samples = [
      { atEpochMs: 1000, timeMs: 2080 },
      { atEpochMs: 1040, timeMs: 0 },
      { atEpochMs: 1080, timeMs: 40 },
    ];
    expect(independentWraps(samples, 2120, 1)).toBe(1);
    expect(independentWraps(samples.slice(1), 2120, 1)).toBe(0);
    for (const changed of [
      [{ atEpochMs: 1000, timeMs: 1000 }, samples[1]],
      [samples[0], { atEpochMs: 1500, timeMs: 0 }],
      [samples[1], { atEpochMs: 1080, timeMs: 1500 }],
      [samples[0], { atEpochMs: 1040, timeMs: NaN }],
    ])
      expect(() => independentWraps(changed, 2120, 1)).toThrow();
  });
  it('bounds metadata collection, rejects images/unknown fields and records missing batches explicitly', () => {
    const documents = new Map();
    const batch = {
      documentId: '11223344-5566-4788-9911-aabbccddeeff',
      documentStartedEpochMs: 1000,
      sequence: 0,
      sourceSha256: 'a'.repeat(64),
      limitations: [],
      events: [],
      samples: [{ atEpochMs: 1100, timeMs: 100 }],
      presentations: [],
    };
    appendLoopTrace(documents, batch, batch.sourceSha256);
    appendLoopTrace(documents, batch, batch.sourceSha256);
    expect(documents.get(batch.documentId).samples).toHaveLength(1);
    expect(() =>
      appendLoopTrace(
        documents,
        {
          ...batch,
          sequence: 1,
          samples: [{ ...batch.samples[0], rawFrame: 'private-image' }],
        },
        batch.sourceSha256,
      ),
    ).toThrow();
    expect(() =>
      appendLoopTrace(
        documents,
        { ...batch, sequence: 1, samples: Array(129).fill(batch.samples[0]) },
        batch.sourceSha256,
      ),
    ).toThrow();
    appendLoopTrace(documents, { ...batch, sequence: 2 }, batch.sourceSha256);
    expect(documents.get(batch.documentId).limitations).toContain(
      'COLLECTOR_BATCH_GAP',
    );
  });
  it('rejects absent native exports instead of fabricating a successful observation', async () => {
    const result = verifyNativeLoop(
      {},
      {},
      {},
      await loadNativeEncodedAssets(),
    );
    expect(result.status).toBe('FAIL');
    expect(result.achieved).toBe(false);
    expect(
      result.errors.map((error: { scope: string }) => error.scope),
    ).toContain('native-capture-and-export');
  });
});
