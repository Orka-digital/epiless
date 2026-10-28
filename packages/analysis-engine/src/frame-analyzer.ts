import type { Finding } from '@epi-less/core';
import type { SpatialEvidence } from '@epi-less/core';
import { expandActiveTiles } from './active-tiles.js';
import { finishAnalysis } from './analysis-result.js';
import { FramePixels } from './frame-pixels.js';
import { exactTranslation, type VisualFieldCalibration } from './spatial.js';
import {
  OpposingPairHistory,
  TransitionHistory,
} from './transition-history.js';
import type {
  AnalysisOptions,
  AnalysisResult,
  CapturedFrame,
} from './types.js';

import { collectCandidates } from './candidate-clusters.js';
const LITTLE_ENDIAN_PACKED_RGBA =
  new Uint8Array(new Uint32Array([0x11223344]).buffer)[0] === 0x44;
/** Coordinate admission, exact pixel histories and result assembly. Finalization returns defensive copies. */
export class FrameAnalyzer extends FramePixels {
  protected get count() {
    return this.quality.count;
  }
  private readonly onCandidate?: (finding: Finding) => void;
  private readonly visualField?: VisualFieldCalibration;
  // Exact Float64 times are shared by all pixels; per-pixel histories use compact
  // indices, not quantized timestamps. Index zero always means no transition.

  private finalized: AnalysisResult | undefined;

  private readonly findings: Finding[] = [];
  private mergeFrom = 0;

  private currentRgba: Uint8Array | Uint8ClampedArray | undefined;
  private currentMotion: SpatialEvidence['motion'] = {
    kind: 'NONE_DEMONSTRATED',
    automaticallyExcluded: false,
  };

  constructor(options: AnalysisOptions = {}) {
    super(options);
    this.onCandidate = options.onCandidate;
    this.visualField = options.visualField;
    this.frameTimes[0] = -Infinity;
  }

  /** Record missing coverage and reset temporal histories before accepting another frame. */
  markInterrupted(
    reason = 'Capture was interrupted; unobserved intervals are not assessed.',
  ): void {
    if (this.finalized) throw new Error('Analysis already finalized');
    this.quality.interrupted = true;
    this.quality.notes.add(reason.slice(0, 2000));
    // Do not join transitions across an interruption, even if the next timestamp is close.
    if (this.quality.count) this.resetTemporalState();
  }

  /** Reserve native pixel state before the observation window opens. This does
   * not submit a frame, establish a timestamp, or create diagnostic evidence. */
  prepare(width: number, height: number): void {
    if (this.backendFailed)
      throw new Error(
        'Analysis backend failed; create a new analyzer before accepting frames.',
      );
    if (this.finalized || this.quality.count)
      throw new Error('Analysis has already started');
    if (
      ![width, height].every(
        (n) => Number.isInteger(n) && n > 0 && n <= 16384,
      ) ||
      width * height > this.quality.maxPixels
    )
      throw new TypeError('Invalid preparation dimensions');
    if (this.width !== width || this.height !== height)
      this.allocate(width, height);
  }

  /** Current fixed input allocation; a converter must request it after prepare
   * and again after a geometry change. No temporal state is copied per frame. */
  getInputRgba(): Uint8ClampedArray | undefined {
    return this.wasmArena?.inputRgba;
  }

  protected onAllocationReset(): void {
    this.mergeFrom = this.findings.length;
  }
  protected onBackendFailure(): void {
    this.backendFailed = true;
    this.quality.interrupted = true;
    this.quality.notes.add(
      'WASM state initialization failed after capture started; this frame was not retried.',
    );
  }

  private resetTemporalState(): void {
    this.allocate(this.width, this.height);
  }

  /** Admit a real frame once; rejected frames and interruptions never bridge temporal histories. */
  pushFrame(frame: CapturedFrame): void {
    if (this.backendFailed)
      throw new Error(
        'Analysis backend failed; create a new analyzer before accepting frames.',
      );
    if (this.finalized) throw new Error('Analysis already finalized');
    const relativeTime = this.quality.admit(frame, {
      width: this.width,
      height: this.height,
      allocate: (width, height) => this.allocate(width, height),
      reset: () => this.resetTemporalState(),
    });
    if (relativeTime === undefined) return;
    const { rgba, width, height } = frame;
    if (this.frameIndex === 65535) {
      this.quality.interrupted = true;
      this.quality.notes.add(
        'The bounded 65,535-frame temporal epoch ended; histories were reset without joining transitions across the boundary.',
      );
      this.resetTemporalState();
    }
    this.frameTimes[++this.frameIndex] = relativeTime;
    this.diagnosticHistory?.push(rgba, relativeTime, this.previousFrame);
    // An actual decoded frame with identical RGBA adds real cadence and trace
    // evidence but cannot create a transition. This is not synthetic sampling.
    if (this.diagnosticHistory && !this.diagnosticHistory.changed) {
      // The pixels are unchanged, but this is a new accepted source frame.
      if (this.previousFrame) this.previousFrameAtMs = relativeTime;
      return;
    }
    this.general.active.fill(0);
    this.red.active.fill(0);
    this.general.hasActive = false;
    this.red.hasActive = false;
    this.general.activeSeedCount = this.red.activeSeedCount = 0;
    const changedRuns = this.diagnosticHistory?.changedRuns;
    this.prepareTiles(rgba, changedRuns);
    this.processPixels(rgba, width, height, changedRuns);
    const activeTiles = {
      width: this.width,
      height: this.height,
      representativeCount: this.representativeCount,
      representatives: this.representatives,
      tileColumns: this.tileColumns,
      tileUniform: this.tileUniform,
      tileDependents: this.tileDependents,
    };
    expandActiveTiles(this.general, activeTiles);
    expandActiveTiles(this.red, activeTiles);
    this.currentRgba = rgba;
    this.currentMotion =
      this.general.hasActive || this.red.hasActive
        ? exactTranslation(rgba, this.previousFrame, width, height, changedRuns)
        : { kind: 'NONE_DEMONSTRATED', automaticallyExcluded: false };
    this.cluster(this.general, 'GENERAL_FLASH', relativeTime);
    this.cluster(this.red, 'RED_FLASH', relativeTime);
    if (rgba.byteOffset % 4 === 0) {
      this.previousFrame ??= new Uint32Array(width * height);
      this.previousFrame.set(
        new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.byteLength / 4),
      );
    } else this.previousFrame = undefined;
    this.previousFrameAtMs = this.previousFrame ? relativeTime : undefined;
    this.currentRgba = undefined;
  }

  /** Exact dense native route; geometry, diagnostics and frame clocks stay in pushFrame. */

  private processPixels(
    rgba: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    changedRuns: Uint32Array | undefined,
  ): void {
    if (
      changedRuns === undefined &&
      (this.representativeCount === width * height ||
        (this.wasmArena && this.representativeCount > (width * height) / 2)) &&
      LITTLE_ENDIAN_PACKED_RGBA &&
      rgba.byteOffset % 4 === 0
    ) {
      this.processDensePacked(
        new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.byteLength / 4),
      );
    } else {
      this.processSparse(rgba, width, height, changedRuns);
    }
  }
  private cluster(
    history: TransitionHistory | OpposingPairHistory,
    type: Finding['type'],
    ended: number,
  ): void {
    collectCandidates(
      {
        width: this.width,
        height: this.height,
        downsampled: this.quality.downsampled,
        visualField: this.visualField,
        queue: this.queue,
        representatives: this.representatives,
        findings: this.findings,
        mergeFrom: this.mergeFrom,
        currentRgba: this.currentRgba,
        previousFrame: this.previousFrame,
        previousFrameAtMs: this.previousFrameAtMs,
        currentMotion: this.currentMotion,
        diagnosticHistory: this.diagnosticHistory,
        sourceWidth: this.quality.sourceWidth,
        sourceHeight: this.quality.sourceHeight,
        onCandidate: this.onCandidate,
        notes: this.quality.notes,
      },
      history,
      type,
      ended,
    );
  }

  /** Freeze numeric evidence and release volatile diagnostics; repeated calls return independent copies. */
  finish(): AnalysisResult {
    if (this.finalized) return structuredClone(this.finalized);
    this.finalized = finishAnalysis({
      ...this.quality.summary(),
      findings: this.findings,
      width: this.width,
      height: this.height,
      sourceWidth: this.quality.sourceWidth,
      sourceHeight: this.quality.sourceHeight,
      stateBytes: this.stateBytes,
    });
    // Final reports retain numeric evidence only; release volatile frame buffers.
    this.diagnosticHistory = undefined;
    return structuredClone(this.finalized);
  }
}
