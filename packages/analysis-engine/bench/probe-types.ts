import type { AnalysisOptions, FrameAnalyzer } from '../src/index.js';
import type { Finding } from '../../core/src/index.js';
import type {
  VisualFieldCalibration,
  balancedCheckerboard,
} from '../src/spatial.js';
export type NumericArray =
  | Uint8Array
  | Uint8ClampedArray
  | Int8Array
  | Uint16Array
  | Uint32Array
  | Int32Array
  | Float64Array;
type BufferKey =
  | 'frameTimes'
  | 'luminance'
  | 'direction'
  | 'redAnchor'
  | 'saturated'
  | 'redPending'
  | 'redDu'
  | 'redDv'
  | 'redStart'
  | 'previousRgb'
  | 'representatives'
  | 'queue'
  | 'tileUniform'
  | 'tilePeers'
  | 'tileDependents'
  | 'tileCandidates'
  | 'tileCandidateCounts';
interface HistoryProbe {
  starts: NumericArray;
  count: NumericArray;
  next: NumericArray;
  active: Uint8Array;
  activeSeeds: NumericArray;
  previous: NumericArray;
  tripleEndingPrevious: NumericArray;
  candidateStarts: NumericArray;
  hasActive: boolean;
  activeSeedCount: number;
  activeCount: number;
  earliestActive: number;
  firstActive: number;
  lastActive: number;
}
/** Structural view used only by differential harnesses to inspect frozen/current internals. */
export interface AnalyzerProbe
  extends
    Pick<FrameAnalyzer, keyof FrameAnalyzer>,
    Record<BufferKey, NumericArray> {
  previousFrame: Uint32Array | undefined;
  general: HistoryProbe;
  red: HistoryProbe;
  width: number;
  height: number;
  downsampled: boolean;
  visualField?: VisualFieldCalibration;
  frameIndex: number;
  representativeCount: number;
  tilesPrepared: boolean;
  invalid: boolean;
  interrupted: boolean;
  count: number;
  first: number;
  last: number;
  gap: number;
  stateBytes: number;
  wasmArena: Pick<
    import('../src/wasm-dense.js').WasmDenseArena,
    'extraAllocatedBytes' | 'report'
  >;
  currentRgba: Uint8Array | Uint8ClampedArray | undefined;
  currentMotion: NonNullable<Finding['spatial']>['motion'];
  findings: Finding[];
  mergeFrom: number;
  cluster: (
    history: HistoryProbe,
    type: Finding['type'],
    ended: number,
  ) => void;
  processDensePacked: (words: Uint32Array) => void;
}
export interface EngineModule {
  FrameAnalyzer: new (options?: AnalysisOptions) => AnalyzerProbe;
  ENGINE_VERSION: string;
  combinedMaskFieldAnalysis: typeof import('../src/spatial.js').combinedMaskFieldAnalysis;
}
export type Checkerboard = typeof balancedCheckerboard;

export type SpatialProbe = Pick<
  AnalyzerProbe,
  | 'width'
  | 'height'
  | 'frameIndex'
  | 'mergeFrom'
  | 'downsampled'
  | 'visualField'
  | 'currentRgba'
  | 'currentMotion'
  | 'findings'
  | 'cluster'
>;
