import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  verifyRecheckProvenance,
  verifyRecheckOrder,
  verifyMeasuredMediaEvents,
} from './verify-native-media-recheck.mjs';
import {
  NativeEncodedRecheckFixture,
  recheckMediaPath,
} from './native-encoded-recheck-source.mjs';
import { loadNativeEncodedAssets, sha256 } from './native-encoded-source.mjs';
import { nativeCandidatePage } from './native-candidate-page.mjs';

describe('explicit native encoded recheck fixture', () => {
  it('preserves default HTML while only the opt-in action omits its redundant seek', async () => {
    const assets = await loadNativeEncodedAssets();
    const fixture = new NativeEncodedRecheckFixture(assets);
    const original = nativeCandidatePage({
      encoded: { url: '/original.webm' },
    });
    expect(original).toContain('marker.currentTime=0;marker.play()');
    const html = fixture.document(false);
    expect(html).not.toContain('marker.currentTime=0');
    expect(html).toContain('if(state.encoded){marker.play()');
    expect(html).toContain(recheckMediaPath);
    expect(sha256(html)).toBe(fixture.documents[0].servedHtmlSha256);
    expect(nativeCandidatePage({ encoded: { url: '/original.webm' } })).toBe(
      original,
    );
  });
  it('pins the real served file to the last fresh document and records distinct bytes at one URL', async () => {
    const assets = await loadNativeEncodedAssets();
    const fixture = new NativeEncodedRecheckFixture(assets);
    const received: Buffer[] = [];
    const headers: Record<string, unknown> = {};
    const response = {
      setHeader: (key: string, value: unknown) => {
        headers[key] = value;
      },
      end: (bytes: Buffer) => received.push(bytes),
    };
    for (const fixed of [false, true, false]) {
      fixture.document(fixed);
      fixture.serve(
        { url: recheckMediaPath, method: 'GET', headers: {} },
        response,
      );
    }
    expect(received.map(sha256)).toEqual([
      assets.assets.signal.record.sha256,
      assets.assets.fixed.record.sha256,
      assets.assets.signal.record.sha256,
    ]);
    expect(
      new Set(fixture.documents.map((value: any) => value.documentId)).size,
    ).toBe(3);
    expect(new Set(fixture.requests.map((value: any) => value.path)).size).toBe(
      1,
    );
    expect(headers['Cache-Control']).toBe('no-store');
    expect(fixture.requests.map((value: any) => value.documentId)).toEqual(
      fixture.documents.map((value: any) => value.documentId),
    );
  });
  it('rejects page evidence claiming a source other than its served document', async () => {
    const assets = await loadNativeEncodedAssets();
    const fixture = new NativeEncodedRecheckFixture(assets);
    fixture.document(false);
    const record = fixture.documents[0];
    const page = {
      recheckDocument: { ...record },
      source: 'ENCODED_VP9_WEBM',
      encoded: { sourceSha256: record.sourceSha256 },
      events: [],
      samples: [],
      presentations: [],
    };
    fixture.append(page);
    expect(fixture.snapshot().pageEvidence).toHaveLength(1);
    expect(() =>
      fixture.append({
        ...page,
        encoded: { sourceSha256: assets.assets.fixed.record.sha256 },
      }),
    ).toThrow();
    expect(() =>
      fixture.append({
        ...page,
        recheckDocument: { ...record, documentId: 'not-served' },
      }),
    ).toThrow();
    expect(() =>
      fixture.append({ ...page, presentations: Array(513).fill({}) }),
    ).toThrow();
    expect(fixture.snapshot().pageEvidence).toHaveLength(1);
  });
  it('binds provenance to the actual helper and reconstructed served HTML, rejecting valid-looking substituted hashes', async () => {
    const assets = await loadNativeEncodedAssets();
    const fixture = new NativeEncodedRecheckFixture(assets);
    fixture.document(false);
    const record = fixture.documents[0];
    const identity = Object.fromEntries(
      [
        'documentId',
        'fixed',
        'url',
        'sourceSha256',
        'sourceBytes',
        'manifestSha256',
      ].map((key) => [key, record[key]]),
    );
    const environment = {
      extensionBuild: {
        algorithm: 'sha256',
        input: 'sorted dist filenames, NUL, bytes, NUL',
        digest: 'a'.repeat(64),
      },
      encodedRecheck: {
        moduleSha256: sha256(
          await readFile(
            new URL('./native-encoded-recheck-source.mjs', import.meta.url),
          ),
        ),
        ...fixture.snapshot(),
      },
    };
    expect(() =>
      verifyRecheckProvenance(environment, assets, false, identity),
    ).not.toThrow();
    for (const mutate of [
      (value: any) => {
        delete value.extensionBuild.digest;
      },
      (value: any) => {
        value.extensionBuild.algorithm = 'other';
      },
      (value: any) => {
        value.encodedRecheck.moduleSha256 = 'b'.repeat(64);
      },
      (value: any) => {
        value.encodedRecheck.documents[0].servedHtmlSha256 = 'b'.repeat(64);
      },
    ]) {
      const changed = structuredClone(environment);
      mutate(changed);
      expect(() =>
        verifyRecheckProvenance(changed, assets, false, identity),
      ).toThrow();
    }
    expect(() =>
      verifyRecheckProvenance(environment, assets, true, identity),
    ).toThrow();
  });
  it('requires actual baseline, fixed, then recurrence chronology with distinct job IDs', () => {
    const jobs = [0, 1, 2].map((index) => ({
      id: String(index),
      startedAt: new Date(1000 + index * 10000).toISOString(),
      endedAt: new Date(2000 + index * 10000).toISOString(),
    }));
    expect(() => verifyRecheckOrder(jobs)).not.toThrow();
    expect(() => verifyRecheckOrder([jobs[0], jobs[2], jobs[1]])).toThrow();
    expect(() =>
      verifyRecheckOrder([jobs[0], jobs[1], { ...jobs[2], id: jobs[1].id }]),
    ).toThrow();
  });
  it('accepts only a post-measurement restoration to the original saved media position', () => {
    const end = 1793127772502.4;
    const actual = { kind: 'EXPLICIT_SEEK', at: 1793127772508.1, mediaTime: 0 };
    expect(verifyMeasuredMediaEvents([actual], end - 5110.4, end, 0)).toEqual([
      {
        atEpochMs: actual.at,
        afterMeasurementMs: actual.at - end,
        afterObservationMs: actual.at - end,
        restoredTimeMs: 0,
      },
    ]);
    expect(() =>
      verifyMeasuredMediaEvents(
        [{ ...actual, at: end - 1 }],
        end - 5110.4,
        end,
        0,
      ),
    ).toThrow();
    expect(() =>
      verifyMeasuredMediaEvents([{ ...actual, at: end }], end - 5110.4, end, 0),
    ).toThrow();
    expect(() =>
      verifyMeasuredMediaEvents(
        [{ ...actual, at: end - 6000 }],
        end - 5110.4,
        end,
        0,
      ),
    ).toThrow();
    expect(() =>
      verifyMeasuredMediaEvents(
        [{ ...actual, mediaTime: 0.001 }],
        end - 5110.4,
        end,
        0,
      ),
    ).toThrow();
    expect(() =>
      verifyMeasuredMediaEvents([actual, actual], end - 5110.4, end, 0),
    ).toThrow();
    expect(() =>
      verifyMeasuredMediaEvents(
        [{ ...actual, at: end + 1 }],
        end - 5110.4,
        end,
        0,
        end + 2,
      ),
    ).toThrow();
    expect(
      verifyMeasuredMediaEvents([actual], end - 5110.4, end, 0, end + 2)[0]
        .afterObservationMs,
    ).toBe(actual.at - end - 2);
    for (const kind of [
      'MEDIA_ERROR',
      'RVFC_UNAVAILABLE',
      'ENCODED_TIMESTAMP_UNMATCHED',
    ])
      expect(() =>
        verifyMeasuredMediaEvents(
          [actual, { kind, at: end + 20 }],
          end - 5110.4,
          end,
          0,
        ),
      ).toThrow();
  });
});
