import type { Finding, FrameQuality } from '@epi-less/core';
import { type VisualFieldCalibration } from './spatial.js';
export interface CapturedFrame {
  rgba: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  timestampMs: number;
  sourceWidth?: number;
  sourceHeight?: number;
}
export interface AnalysisBackendStats {
  backend: 'WASM_DENSE' | 'JS';
  selectionReason: 'READY' | 'FORCED_JS' | 'UNAVAILABLE';
  denseFrames: number;
  inputCopiedBytes: number;
  inputCopyMs: number;
  kernelMs: number;
  wasmMemoryBytes: number;
  migratedStateBytes: number;
  extraStateBytes: number;
  engineStateBytes: number;
  embeddedKernelBytes: number;
}
export interface AnalysisOptions {
  /** AUTO selects the exact WASM dense route when initialization succeeds. */
  backend?: 'AUTO' | 'JS';
  minEffectiveFps?: number;
  maxGapMs?: number;
  maxPixels?: number;
  /** Bounded representative-pixel evidence; disable only for numeric benchmarks. */
  diagnostics?: boolean;
  /** Called once when a new candidate is first observed; never contains frame images. */
  onCandidate?: (finding: Finding) => void;
  /** Explicit source-pixel field: physical calibration or labelled reference geometry. */
  visualField?: VisualFieldCalibration;
}
export interface AnalysisResult {
  status: 'NO_ISSUES_OBSERVED' | 'NEEDS_REVIEW' | 'INCONCLUSIVE';
  passed: null;
  quality: FrameQuality;
  findings: Finding[];
  limitations: string[];
}
