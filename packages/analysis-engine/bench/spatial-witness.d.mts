import type { Finding, SpatialEvidence } from '@epi-less/core';
import type { VisualFieldCalibration } from '../src/spatial.js';

type Rectangle = { x: number; y: number; width: number; height: number };
type Update = {
  frameIndex: number;
  sampledAtMs: number;
  rgbaSha256: string;
  maskSha256: string;
  maskBase64: string;
  previousRank: number[];
  nextRank: number[];
  spatial: SpatialEvidence;
};
export function independentMaskWitness(
  mask: Uint8Array,
  width: number,
  height: number,
  field?: VisualFieldCalibration,
): {
  total: number;
  area?: SpatialEvidence['visualField'];
  components: Array<{ pixels: number; region: Rectangle }>;
};
export function spatialRank(spatial: SpatialEvidence): number[];
export function strongerSpatial(
  next: SpatialEvidence,
  previous: SpatialEvidence,
): boolean;
export function observeFrozenSpatial(
  analyzer: import('./probe-types.js').SpatialProbe,
  frozenCheckerboard: (
    rgba: Uint8Array | Uint8ClampedArray,
    width: number,
    region: Rectangle,
    field?: VisualFieldCalibration,
  ) => SpatialEvidence['pattern'],
): {
  assertFindings(
    frozen: Finding[],
    current: Finding[],
    label: string,
  ): Finding[];
  evidence(): {
    capturedMasks: number;
    comparedFindings: number;
    differingSpatialChecks: number;
    findingsWithSpatialUpdates: Array<{
      id: string;
      initial: SpatialEvidence;
      retained: SpatialEvidence;
      updates: Update[];
    }>;
  };
};
