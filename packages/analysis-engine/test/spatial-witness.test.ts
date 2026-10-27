import { describe, expect, it } from 'vitest';
import type { Finding, SpatialEvidence } from '@epi-less/core';
import type { VisualFieldCalibration } from '../src/spatial.js';
import {
  independentMaskWitness,
  observeFrozenSpatial,
  strongerSpatial,
} from '../bench/spatial-witness.mjs';

const field: VisualFieldCalibration = {
  widthPx: 4,
  heightPx: 3,
  basis: 'EXPLICIT_CALIBRATION',
  reference: 'Small independent witness-validator fixture',
};
const none = {
  kind: 'NONE_DEMONSTRATED',
  automaticallyExcluded: false,
} as const;
const initial: SpatialEvidence = {
  version: 1,
  coordinateSpace: 'ANALYSIS_PIXELS',
  analysisWidth: 4,
  analysisHeight: 3,
  sampledAtMs: 700,
  componentPixels: 2,
  simultaneousPixels: 2,
  simultaneousRatio: 2 / 12,
  maskBasis: 'QUALIFYING_TRANSITIONS_SAME_FRAME',
  visualField: {
    ...field,
    maximumPixels: 2,
    maximumRatio: 2 / 12,
    thresholdRatio: 0.25,
    exceedsThreshold: false,
    window: { x: 0, y: 0, width: 4, height: 3 },
  },
  pattern: none,
  motion: none,
};

describe('independent spatial-witness differential gate', () => {
  it('sums disconnected actual pixels, resolves the first maximal window, and retains the full denominator beyond image edges', () => {
    const mask = new Uint8Array(12);
    for (const p of [0, 4, 3, 7]) mask[p] = 1;
    const measured = independentMaskWitness(mask, 4, 3, field);
    expect(measured.total).toBe(4);
    expect(measured.components).toEqual([
      { pixels: 2, region: { x: 0, y: 0, width: 1, height: 2 } },
      { pixels: 2, region: { x: 3, y: 0, width: 1, height: 2 } },
    ]);
    expect(measured.area).toMatchObject({
      maximumPixels: 4,
      maximumRatio: 4 / 12,
      exceedsThreshold: true,
    });
    expect(
      independentMaskWitness(mask, 4, 3, { ...field, widthPx: 1, heightPx: 2 })
        .area,
    ).toMatchObject({
      maximumPixels: 2,
      window: { x: 0, y: 0, width: 1, height: 2 },
    });
    expect(
      independentMaskWitness(mask, 4, 3, { ...field, widthPx: 8, heightPx: 6 })
        .area,
    ).toMatchObject({ maximumPixels: 4, maximumRatio: 4 / 48 });
    mask[1] = 2;
    expect(() => independentMaskWitness(mask, 4, 3, field)).toThrow();
  });

  it('requires a strict rank increase and does not replace equal maxima with later timestamps', () => {
    expect(strongerSpatial({ ...initial, sampledAtMs: 850 }, initial)).toBe(
      false,
    );
    expect(
      strongerSpatial(
        { ...initial, simultaneousPixels: 3, visualField: initial.visualField },
        initial,
      ),
    ).toBe(true);
    expect(
      strongerSpatial(
        {
          ...initial,
          simultaneousPixels: 10,
          visualField: { ...initial.visualField!, maximumPixels: 1 },
        },
        initial,
      ),
    ).toBe(false);
  });

  it('rejects changed time, counts, pattern, motion and non-spatial fields rather than removing spatial from comparison', () => {
    const frozen = {
      width: 4,
      height: 3,
      frameIndex: 42,
      mergeFrom: 0,
      downsampled: false,
      visualField: field,
      currentRgba: new Uint8Array(48),
      currentMotion: none,
      findings: [] as Finding[],
      cluster(
        history: { active: Uint8Array },
        type: Finding['type'],
        ended: number,
      ) {
        if (!this.findings.length)
          this.findings.push({
            id: 'candidate-1',
            severity: 'warning',
            reviewStatus: 'NEEDS_REVIEW',
            startMs: 0,
            flashesInWindow: 4,
            affectedRatio: 2 / 12,
            message: 'Independent spatial witness fixture',
            type,
            endMs: ended,
            region: { x: 0, y: 0, width: 1, height: 2 },
            spatial: structuredClone(initial),
          });
        else this.findings[0]!.endMs = ended;
        history.active.fill(0);
      },
    };
    const witness = observeFrozenSpatial(frozen, () => none);
    const firstMask = new Uint8Array(12);
    firstMask[0] = firstMask[4] = 1;
    frozen.cluster(
      { active: firstMask, hasActive: true, activeCount: 2 } as any,
      'GENERAL_FLASH',
      700,
    );
    const laterMask = new Uint8Array(12);
    for (const p of [0, 4, 3, 7]) laterMask[p] = 1;
    frozen.frameIndex = 51;
    frozen.cluster(
      { active: laterMask, hasActive: true, activeCount: 4 } as any,
      'GENERAL_FLASH',
      850,
    );
    const evidence = witness.evidence();
    expect(evidence.findingsWithSpatialUpdates).toHaveLength(1);
    expect(evidence.findingsWithSpatialUpdates[0].updates).toHaveLength(1);
    const retained = evidence.findingsWithSpatialUpdates[0].retained;
    const actual = [{ ...frozen.findings[0]!, spatial: retained }];
    expect(() =>
      witness.assertFindings(frozen.findings, actual, 'valid'),
    ).not.toThrow();
    for (const tamper of [
      (f: any) => {
        f.spatial.sampledAtMs = 849;
      },
      (f: any) => {
        f.spatial.componentPixels = 3;
      },
      (f: any) => {
        f.spatial.visualField.maximumPixels = 5;
      },
      (f: any) => {
        f.spatial.pattern = { kind: 'EXACT_BALANCED_CHECKERBOARD' };
      },
      (f: any) => {
        f.spatial.motion = { kind: 'EXACT_TRANSLATION_COMPATIBLE', dx: 1 };
      },
      (f: any) => {
        f.endMs = 851;
      },
    ]) {
      const changed = structuredClone(actual);
      tamper(changed[0]);
      expect(() =>
        witness.assertFindings(frozen.findings, changed, 'tampered'),
      ).toThrow();
    }
    expect(frozen.findings[0]!.spatial).toEqual(initial);
  });
});
