import { ExactSrgbCache } from './color-cache.js';
import { DiagnosticHistory } from './diagnostic-history.js';
import {
  OpposingPairHistory,
  TransitionHistory,
} from './transition-history.js';
import type { AnalysisBackendStats, AnalysisOptions } from './types.js';
import { EMBEDDED_KERNEL_BYTES, WasmDenseArena } from './wasm-dense.js';
/** Owns cold-path buffer allocation and exact retained-memory accounting.
 * Inherited fields stay direct properties: pixel loops incur no getter/proxy overhead. */
export abstract class FrameMemory {
  protected readonly diagnosticsEnabled: boolean;
  protected wasmArena: WasmDenseArena | undefined;
  protected backendReason: AnalysisBackendStats['selectionReason'];
  protected frameTimes: Float64Array = new Float64Array(65536);
  protected readonly colors = new ExactSrgbCache();
  protected frameIndex = 0;
  protected diagnosticHistory: DiagnosticHistory | undefined;
  protected width = 0;
  protected height = 0;
  protected general!: TransitionHistory;
  protected red!: OpposingPairHistory;
  protected luminance!: Float64Array;
  protected direction!: Int8Array;
  protected redAnchor!: Uint32Array;
  protected saturated!: Uint8Array;
  protected redPending!: Uint8Array;
  protected redDu!: Float64Array;
  protected redDv!: Float64Array;
  protected redStart!: Uint16Array;
  protected queue!: Int32Array;
  protected previousRgb!: Uint32Array;
  protected representatives!: Uint32Array;
  protected tileUniform!: Uint8Array;
  protected tilePeers!: Int32Array;
  protected tileDependents!: Uint32Array;
  protected tilesPrepared = false;
  protected readonly tileCandidates = new Int32Array(4096 * 8);
  protected readonly tileCandidateCounts = new Uint8Array(4096);
  protected tileColumns = 0;
  protected representativeCount = 0;
  protected previousFrame: Uint32Array | undefined;
  protected previousFrameAtMs: number | undefined;
  protected stateBytes = 0;
  protected abstract count: number;
  protected abstract onAllocationReset(): void;
  protected abstract onBackendFailure(): void;
  protected constructor(options: AnalysisOptions) {
    if (
      options.backend !== undefined &&
      options.backend !== 'AUTO' &&
      options.backend !== 'JS'
    )
      throw new TypeError('Invalid analysis backend');
    this.backendReason = options.backend === 'JS' ? 'FORCED_JS' : 'READY';
    this.diagnosticsEnabled = options.diagnostics !== false;
  }
  protected allocate(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.diagnosticHistory = this.diagnosticsEnabled
      ? new DiagnosticHistory(width, height)
      : undefined;
    this.onAllocationReset();
    const size = width * height;
    const previousTimes = this.frameTimes;
    if (this.wasmArena?.width === width && this.wasmArena.height === height) {
      this.wasmArena.reset();
    } else if (this.backendReason === 'READY') {
      try {
        // Budget before allocating the arena. These auxiliary arrays remain in
        // JS; migrated temporal arrays are counted only inside WASM pages.
        const tiles = Math.ceil(width / 8) * Math.ceil(height / 8);
        const auxiliaryBytes =
          this.colors.allocatedBytes +
          size * 8 +
          tiles * 9 +
          this.tileCandidates.byteLength +
          this.tileCandidateCounts.byteLength +
          (this.diagnosticHistory?.allocatedBytes ?? 0) +
          EMBEDDED_KERNEL_BYTES;
        this.wasmArena = new WasmDenseArena(
          width,
          height,
          256 * 1024 * 1024 - auxiliaryBytes,
        );
      } catch (error) {
        if (this.count) {
          this.onBackendFailure();
          throw error;
        }
        // A pre-observation re-prepare may replace an earlier arena. Do not
        // retain its entire buffer through the timestamp view on JS fallback.
        if (this.wasmArena) this.frameTimes = new Float64Array(previousTimes);
        this.wasmArena = undefined;
        this.backendReason = 'UNAVAILABLE';
      }
    }
    const arena = this.wasmArena;
    if (arena) {
      this.frameTimes = arena.views.times as Float64Array;
      if (previousTimes.buffer !== this.frameTimes.buffer)
        this.frameTimes.set(previousTimes);
    }
    this.representativeCount = size;
    this.frameIndex = 0;
    this.general = new TransitionHistory(size, this.frameTimes, arena);
    this.red = new OpposingPairHistory(size, this.frameTimes, arena);
    this.luminance =
      (arena?.views.luminance as Float64Array | undefined) ??
      new Float64Array(size).fill(NaN);
    this.direction =
      (arena?.views.direction as Int8Array | undefined) ?? new Int8Array(size);
    this.redAnchor =
      (arena?.views.anchor as Uint32Array | undefined) ??
      new Uint32Array(size).fill(0xffffffff);
    this.saturated =
      (arena?.views.saturated as Uint8Array | undefined) ??
      new Uint8Array(size);
    this.redPending =
      (arena?.views.pending as Uint8Array | undefined) ?? new Uint8Array(size);
    this.redDu =
      (arena?.views.du as Float64Array | undefined) ?? new Float64Array(size);
    this.redDv =
      (arena?.views.dv as Float64Array | undefined) ?? new Float64Array(size);
    this.redStart =
      (arena?.views.redstart as Uint16Array | undefined) ??
      new Uint16Array(size);
    this.queue = new Int32Array(size);
    this.previousRgb =
      (arena?.views.previous_rgb as Uint32Array | undefined) ??
      new Uint32Array(size).fill(0xffffffff);
    this.representatives =
      (arena?.views.representatives as Uint32Array | undefined) ??
      new Uint32Array(size);
    for (let pixel = 0; pixel < size; pixel++)
      this.representatives[pixel] = pixel;
    this.tileColumns = Math.ceil(width / 8);
    this.tileUniform = new Uint8Array(this.tileColumns * Math.ceil(height / 8));
    this.tilePeers = new Int32Array(this.tileUniform.length).fill(-1);
    this.tileDependents = new Uint32Array(this.tileUniform.length);
    this.tilesPrepared = false;
    this.tileCandidateCounts.fill(0);
    this.previousFrame = new Uint32Array(size);
    this.previousFrameAtMs = undefined;
    this.stateBytes =
      this.frameTimes.byteLength +
      this.colors.allocatedBytes +
      this.general.starts.byteLength +
      this.general.count.byteLength +
      this.general.next.byteLength +
      this.general.active.byteLength +
      this.general.activeSeeds.byteLength +
      this.red.starts.byteLength +
      this.red.previous.byteLength +
      this.red.tripleEndingPrevious.byteLength +
      this.red.candidateStarts.byteLength +
      this.red.active.byteLength +
      this.red.activeSeeds.byteLength +
      this.luminance.byteLength +
      this.direction.byteLength +
      this.redAnchor.byteLength +
      this.saturated.byteLength +
      this.redPending.byteLength +
      this.redDu.byteLength +
      this.redDv.byteLength +
      this.redStart.byteLength +
      this.queue.byteLength +
      this.previousRgb.byteLength +
      this.representatives.byteLength +
      this.tileUniform.byteLength +
      this.tilePeers.byteLength +
      this.tileDependents.byteLength +
      this.tileCandidates.byteLength +
      this.tileCandidateCounts.byteLength +
      size * 4 +
      (this.diagnosticHistory?.allocatedBytes ?? 0) +
      (arena?.extraAllocatedBytes ?? 0) +
      EMBEDDED_KERNEL_BYTES;
    if (this.stateBytes > 256 * 1024 * 1024)
      throw new Error('Total engine-state budget exceeded');
  }
}
