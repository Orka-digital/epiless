import { finishAnalysis } from './analysis-result.js';
import type { Finding } from '@epi-less/core';
import type { SpatialEvidence } from '../../core/src/spatial.js';
import { linear } from './color-cache.js';
import { FrameMemory } from './frame-memory.js';
import { exactTranslation, type VisualFieldCalibration } from './spatial.js';
import {
  OpposingPairHistory,
  TransitionHistory,
} from './transition-history.js';
import type {
  AnalysisBackendStats,
  AnalysisOptions,
  AnalysisResult,
  CapturedFrame,
} from './types.js';
import { EMBEDDED_KERNEL_BYTES } from './wasm-dense.js';

import { collectCandidates } from './candidate-clusters.js';
const LITTLE_ENDIAN_PACKED_RGBA =
  new Uint8Array(new Uint32Array([0x11223344]).buffer)[0] === 0x44;
export class FrameAnalyzer extends FrameMemory {
  private readonly minFps: number;
  private readonly permittedGap: number;
  private readonly maxPixels: number;

  private readonly onCandidate?: (finding: Finding) => void;
  private readonly visualField?: VisualFieldCalibration;
  // Exact Float64 times are shared by all pixels; per-pixel histories use compact
  // indices, not quantized timestamps. Index zero always means no transition.

  private backendFailed = false;
  private denseFrames = 0;
  private inputCopiedBytes = 0;
  private inputCopyMs = 0;
  private kernelMs = 0;

  private sourceWidth = 0;
  private sourceHeight = 0;
  protected count = 0;
  private first = 0;
  private last = 0;
  private gap = 0;
  private downsampled = false;
  private interrupted = false;
  private invalid = false;
  private finalized: AnalysisResult | undefined;
  private readonly notes = new Set<string>();
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
    if (
      options.visualField &&
      (![options.visualField.widthPx, options.visualField.heightPx].every(
        (n) => Number.isInteger(n) && n > 0 && n <= 16384,
      ) ||
        ![
          'EXPLICIT_CALIBRATION',
          'W3C_1024_768_REFERENCE',
          'W3C_CSS_REFERENCE',
        ].includes(options.visualField.basis) ||
        options.visualField.reference.length > 1000 ||
        !options.visualField.reference.length)
    )
      throw new TypeError('Invalid visual-field calibration');
    this.frameTimes[0] = -Infinity;
    this.minFps = options.minEffectiveFps ?? 30;
    this.permittedGap = options.maxGapMs ?? 100;
    this.maxPixels = options.maxPixels ?? 640 * 360;
    if (
      !Number.isFinite(this.minFps) ||
      this.minFps <= 0 ||
      !Number.isFinite(this.permittedGap) ||
      this.permittedGap <= 0 ||
      !Number.isInteger(this.maxPixels) ||
      this.maxPixels < 1 ||
      this.maxPixels > 1920 * 1080
    )
      throw new TypeError('Invalid analysis limits');
  }

  markInterrupted(
    reason = 'Capture was interrupted; unobserved intervals are not assessed.',
  ): void {
    if (this.finalized) throw new Error('Analysis already finalized');
    this.interrupted = true;
    this.notes.add(reason.slice(0, 2000));
    // Do not join transitions across an interruption, even if the next timestamp is close.
    if (this.count) this.resetTemporalState();
  }

  /** Reserve native pixel state before the observation window opens. This does
   * not submit a frame, establish a timestamp, or create diagnostic evidence. */
  prepare(width: number, height: number): void {
    if (this.backendFailed)
      throw new Error(
        'Analysis backend failed; create a new analyzer before accepting frames.',
      );
    if (this.finalized || this.count)
      throw new Error('Analysis has already started');
    if (
      ![width, height].every(
        (n) => Number.isInteger(n) && n > 0 && n <= 16384,
      ) ||
      width * height > this.maxPixels
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

  /** Cumulative execution counters, with current retained-memory accounting. */
  getBackendStats(): Readonly<AnalysisBackendStats> {
    return Object.freeze({
      backend: this.wasmArena ? 'WASM_DENSE' : 'JS',
      selectionReason: this.backendReason,
      denseFrames: this.denseFrames,
      inputCopiedBytes: this.inputCopiedBytes,
      inputCopyMs: this.inputCopyMs,
      kernelMs: this.kernelMs,
      wasmMemoryBytes: this.wasmArena?.memoryBytes ?? 0,
      migratedStateBytes: this.wasmArena?.migratedStateBytes ?? 0,
      extraStateBytes: this.wasmArena?.extraAllocatedBytes ?? 0,
      engineStateBytes: this.stateBytes,
      embeddedKernelBytes: EMBEDDED_KERNEL_BYTES,
    });
  }

  protected onAllocationReset(): void {
    this.mergeFrom = this.findings.length;
  }
  protected onBackendFailure(): void {
    this.backendFailed = true;
    this.interrupted = true;
    this.notes.add(
      'WASM state initialization failed after capture started; this frame was not retried.',
    );
  }

  /** Lossless state sharing. Pixels share temporal state only while their full
   * observed RGBA histories agree, within uniform tiles or identical tile pairs.
   * Every original source pixel is compared. On divergence,
   * materialize the exact prior state before analysing all original pixels.
   * This is neither downsampling nor rotating/subsampling tile coverage. */
  private prepareTiles(
    rgba: Uint8Array | Uint8ClampedArray,
    changedRuns?: Uint32Array,
  ): void {
    const words =
      rgba.byteOffset % 4 === 0
        ? new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.byteLength / 4)
        : undefined;
    let dirty: Uint8Array | undefined;
    if (changedRuns && changedRuns.length < 192) {
      dirty = new Uint8Array(this.tileUniform.length);
      for (let i = 0; i < changedRuns.length; i += 3) {
        let p = changedRuns[i];
        const end = changedRuns[i + 1];
        while (p < end) {
          const row = Math.floor(p / this.width),
            x = p % this.width,
            last = Math.min(this.width - 1, end - 1 - row * this.width);
          for (let tx = x >>> 3; tx <= last >>> 3; tx++)
            dirty[(row >>> 3) * this.tileColumns + tx] = 1;
          p = (row + 1) * this.width;
        }
      }
    }
    for (let ty = 0; ty < this.height; ty += 8) {
      for (let tx = 0; tx < this.width; tx += 8) {
        const tile = (ty >>> 3) * this.tileColumns + (tx >>> 3);
        const peer = this.tilePeers[tile];
        if (dirty && !dirty[tile] && (peer < 0 || !dirty[peer])) continue;
        if (peer >= 0) {
          const seed = ty * this.width + tx;
          const peerSeed =
            Math.floor(peer / this.tileColumns) * 8 * this.width +
            (peer % this.tileColumns) * 8;
          if (words && this.sameTile(words, seed, peerSeed)) {
            if (this.tileUniform[tile] !== this.tileUniform[peer]) {
              this.mapTile(seed, peerSeed);
              this.tileUniform[tile] = this.tileUniform[peer];
            }
          } else {
            // All comparisons/splits precede transition updates, so these are
            // the exact previous histories even when the peer changes too.
            for (let y = 0; y < 8; y++)
              for (let x = 0; x < 8; x++) {
                const pixel = seed + y * this.width + x;
                this.copyPixelState(this.representatives[pixel], pixel);
                this.representatives[pixel] = pixel;
              }
            this.tilePeers[tile] = -1;
            this.tileDependents[peer]--;
            this.representativeCount += 64;
            this.tileUniform[tile] = 2;
          }
          continue;
        }
        if (this.tileUniform[tile] === 2) continue;
        const seed = ty * this.width + tx,
          offset = seed * 4;
        const right = Math.min(tx + 8, this.width),
          bottom = Math.min(ty + 8, this.height);
        let equal = true;
        outer: for (let y = ty; y < bottom; y++)
          for (let x = tx; x < right; x++) {
            const i = (y * this.width + x) * 4;
            if (
              words
                ? words[i / 4] !== words[seed]
                : rgba[i] !== rgba[offset] ||
                  rgba[i + 1] !== rgba[offset + 1] ||
                  rgba[i + 2] !== rgba[offset + 2] ||
                  rgba[i + 3] !== rgba[offset + 3]
            ) {
              equal = false;
              break outer;
            }
          }
        if (equal) {
          if (!this.tileUniform[tile]) {
            this.tileUniform[tile] = 1;
            this.representativeCount -= (right - tx) * (bottom - ty) - 1;
            for (let y = ty; y < bottom; y++)
              this.representatives.fill(
                seed,
                y * this.width + tx,
                y * this.width + right,
              );
          }
        } else {
          const shared = this.tileUniform[tile] === 1;
          this.tileUniform[tile] = 2;
          if (shared)
            this.representativeCount += (right - tx) * (bottom - ty) - 1;
          if (shared)
            for (let y = ty; y < bottom; y++)
              for (let x = tx; x < right; x++) {
                const pixel = y * this.width + x;
                this.representatives[pixel] = pixel;
                if (pixel !== seed) this.copyPixelState(seed, pixel);
              }
        }
      }
    }
    if (!this.tilesPrepared && words) this.shareInitialTiles(words);
    this.tilesPrepared = true;
  }

  private sameTile(words: Uint32Array, first: number, second: number): boolean {
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        if (
          words[first + y * this.width + x] !==
          words[second + y * this.width + x]
        )
          return false;
    return true;
  }

  private mapTile(seed: number, peerSeed: number): void {
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        this.representatives[seed + y * this.width + x] =
          this.representatives[peerSeed + y * this.width + x];
  }

  private shareInitialTiles(words: Uint32Array): void {
    // Hashes only select candidates. All 64 RGBA pixels must match exactly.
    // At most eight canonical candidates per hash bound collision work; an
    // unshared tile retains full per-pixel processing. No later re-coalescing.
    for (let ty = 0; ty + 8 <= this.height; ty += 8)
      for (let tx = 0; tx + 8 <= this.width; tx += 8) {
        const seed = ty * this.width + tx,
          tile = (ty >>> 3) * this.tileColumns + (tx >>> 3);
        let hash = 2166136261;
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x++)
            hash = Math.imul(hash ^ words[seed + y * this.width + x], 16777619);
        const bucket = (hash ^ (hash >>> 16)) & 4095;
        const count = this.tileCandidateCounts[bucket];
        let peer = -1;
        for (let index = 0; index < count; index++) {
          const candidate = this.tileCandidates[bucket * 8 + index];
          const peerSeed =
            Math.floor(candidate / this.tileColumns) * 8 * this.width +
            (candidate % this.tileColumns) * 8;
          if (this.sameTile(words, seed, peerSeed)) {
            peer = candidate;
            this.mapTile(seed, peerSeed);
            break;
          }
        }
        if (peer >= 0) {
          this.representativeCount -= this.tileUniform[tile] === 1 ? 1 : 64;
          this.tilePeers[tile] = peer;
          this.tileDependents[peer]++;
          this.tileUniform[tile] = this.tileUniform[peer];
        } else if (count < 8) {
          this.tileCandidates[bucket * 8 + count] = tile;
          this.tileCandidateCounts[bucket]++;
        }
      }
  }

  private copyPixelState(from: number, to: number): void {
    for (let i = 0; i < 7; i++)
      this.general.starts[to * 7 + i] = this.general.starts[from * 7 + i];
    this.general.count[to] = this.general.count[from];
    this.general.next[to] = this.general.next[from];
    for (let i = 0; i < 3; i++) {
      this.red.starts[to * 3 + i] = this.red.starts[from * 3 + i];
      this.red.previous[to * 3 + i] = this.red.previous[from * 3 + i];
    }
    this.red.tripleEndingPrevious[to] = this.red.tripleEndingPrevious[from];
    this.red.candidateStarts[to] = this.red.candidateStarts[from];
    this.luminance[to] = this.luminance[from];
    this.direction[to] = this.direction[from];
    this.redAnchor[to] = this.redAnchor[from];
    this.saturated[to] = this.saturated[from];
    this.redPending[to] = this.redPending[from];
    this.redDu[to] = this.redDu[from];
    this.redDv[to] = this.redDv[from];
    this.redStart[to] = this.redStart[from];
    this.previousRgb[to] = this.previousRgb[from];
  }

  private expandActiveTiles(
    history: TransitionHistory | OpposingPairHistory,
  ): void {
    if (!history.hasActive) return;
    history.activeCount = 0;
    history.earliestActive = Infinity;
    history.firstActive = Infinity;
    history.lastActive = -1;
    if (this.representativeCount === 1) {
      // Every source pixel has the exact history of pixel zero. A qualifying
      // representative therefore means an exact full active mask, not a box
      // approximation or a count inferred from the current colour alone.
      history.active.fill(1);
      history.activeCount = this.width * this.height;
      history.firstActive = 0;
      history.lastActive = history.activeCount - 1;
      history.earliestActive = history.started(0);
      return;
    }
    let independent = history.activeSeedCount <= history.activeSeeds.length;
    for (
      let index = 0;
      independent && index < history.activeSeedCount;
      index++
    ) {
      const pixel = history.activeSeeds[index],
        tile =
          (Math.floor(pixel / this.width) >>> 3) * this.tileColumns +
          ((pixel % this.width) >>> 3);
      independent =
        this.tileUniform[tile] === 2 && this.tileDependents[tile] === 0;
    }
    if (independent) {
      // Every active representative has exactly one source pixel. There are no
      // aliases to expand; do not scan two million unrelated pixels for one dot.
      history.activeCount = history.activeSeedCount;
      for (let index = 0; index < history.activeSeedCount; index++) {
        const pixel = history.activeSeeds[index];
        history.firstActive = Math.min(history.firstActive, pixel);
        history.lastActive = Math.max(history.lastActive, pixel);
        history.earliestActive = Math.min(
          history.earliestActive,
          history.started(pixel),
        );
      }
      return;
    }
    for (let pixel = 0; pixel < this.width * this.height; pixel++) {
      if (this.representatives[pixel] !== pixel)
        history.active[pixel] = history.active[this.representatives[pixel]];
      if (history.active[pixel]) {
        if (!history.activeCount) history.firstActive = pixel;
        history.lastActive = pixel;
        history.activeCount++;
        if (this.representatives[pixel] === pixel)
          history.earliestActive = Math.min(
            history.earliestActive,
            history.started(pixel),
          );
      }
    }
  }

  private resetTemporalState(): void {
    this.allocate(this.width, this.height);
  }

  pushFrame(frame: CapturedFrame): void {
    if (this.backendFailed)
      throw new Error(
        'Analysis backend failed; create a new analyzer before accepting frames.',
      );
    if (this.finalized) throw new Error('Analysis already finalized');
    const { rgba, width, height, timestampMs } = frame;
    const sourceWidth = frame.sourceWidth ?? width;
    const sourceHeight = frame.sourceHeight ?? height;
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 16384 ||
      height > 16384 ||
      !Number.isInteger(sourceWidth) ||
      !Number.isInteger(sourceHeight) ||
      sourceWidth < 1 ||
      sourceHeight < 1 ||
      sourceWidth > 16384 ||
      sourceHeight > 16384 ||
      width * height > this.maxPixels ||
      !(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) ||
      rgba.length !== width * height * 4 ||
      !Number.isFinite(timestampMs) ||
      timestampMs < 0
    ) {
      this.invalid = true;
      this.notes.add(
        'A malformed or oversized frame was rejected. Capture quality is insufficient.',
      );
      if (this.count) this.resetTemporalState();
      return;
    }
    if (this.count && timestampMs <= this.last) {
      this.invalid = true;
      this.notes.add(
        'Capture timestamps were not strictly increasing. Rejected frames were not analyzed.',
      );
      this.resetTemporalState();
      return;
    }
    const relativeTime = this.count ? timestampMs - this.first : 0;
    if (!this.count) {
      this.first = timestampMs;
      if (this.width !== width || this.height !== height)
        this.allocate(width, height);
    } else {
      const gap = timestampMs - this.last;
      this.gap = Math.max(this.gap, gap);
      if (width !== this.width || height !== this.height) {
        this.interrupted = true;
        this.notes.add(
          'Capture dimensions changed; no transitions were joined across the scale change.',
        );
        this.allocate(width, height);
      } else if (
        sourceWidth !== this.sourceWidth ||
        sourceHeight !== this.sourceHeight
      ) {
        this.interrupted = true;
        this.notes.add(
          'Source dimensions changed; no transitions were joined across the viewport change.',
        );
        this.resetTemporalState();
      } else if (gap > this.permittedGap) this.resetTemporalState();
    }
    this.sourceWidth = sourceWidth;
    this.sourceHeight = sourceHeight;
    if (
      (frame.sourceWidth !== undefined && frame.sourceWidth !== width) ||
      (frame.sourceHeight !== undefined && frame.sourceHeight !== height)
    ) {
      this.downsampled = true;
      this.notes.add(
        'Capture was rescaled. Small flashing regions may have been lost and area is not validated.',
      );
    }
    this.last = timestampMs;
    this.count++;
    if (this.frameIndex === 65535) {
      this.interrupted = true;
      this.notes.add(
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
      let run = 0;
      for (let pixel = changedRuns?.[0] ?? 0; pixel < width * height; pixel++) {
        if (changedRuns) {
          while (run < changedRuns.length && pixel >= changedRuns[run + 1]) {
            run += 3;
            pixel = changedRuns[run] ?? width * height;
          }
          if (pixel >= width * height) break;
        }
        if (this.representatives[pixel] !== pixel) continue;
        const offset = pixel * 4;
        if (rgba[offset + 3] !== 255) {
          this.invalid = true;
          this.notes.add(
            'Non-opaque capture pixels are unsupported; the composited background is unknown.',
          );
          this.luminance[pixel] = NaN;
          this.redAnchor[pixel] = 0xffffffff;
          this.direction[pixel] = 0;
          this.redPending[pixel] = 0;
          this.previousRgb[pixel] = 0xffffffff;
          this.general.count[pixel] = 0;
          this.red.reset(pixel);
          continue;
        }
        const rgb =
          rgba[offset] | (rgba[offset + 1] << 8) | (rgba[offset + 2] << 16);
        // Identical opaque pixels cannot introduce a transition. Temporal histories
        // retain real timestamps; their window is checked on the next complete pair.
        if (this.previousRgb[pixel] === rgb) continue;
        this.previousRgb[pixel] = rgb;
        const r = linear[rgb & 255],
          g = linear[(rgb >>> 8) & 255],
          b = linear[(rgb >>> 16) & 255];
        this.generalTransition(
          pixel,
          0.2126 * r + 0.7152 * g + 0.0722 * b,
          this.frameIndex,
        );
        if (rgb === 0) {
          this.redAnchor[pixel] = 0xffffffff;
          this.redPending[pixel] = 0;
          this.red.reset(pixel);
        } else {
          const saturated = r / (r + g + b) >= 0.8;
          if (this.redAnchor[pixel] === 0xffffffff) {
            this.redAnchor[pixel] = rgb;
            this.saturated[pixel] = saturated ? 1 : 0;
          } else if (saturated || this.saturated[pixel]) {
            const color = this.colors.slot(rgb);
            this.redTransition(pixel, rgb, color, this.frameIndex);
          }
        }
      }
    }
    this.expandActiveTiles(this.general);
    this.expandActiveTiles(this.red);
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
  private processDensePacked(words: Uint32Array): void {
    const arena = this.wasmArena;
    if (!arena) return this.processDenseJavaScript(words);
    let out: Uint32Array;
    try {
      out = arena.process(words, this.frameIndex);
    } catch (error) {
      this.backendFailed = true;
      this.markInterrupted(
        'WASM dense kernel failed; partially updated state was reset, never retried on the same frame.',
      );
      throw error;
    }
    this.denseFrames++;
    this.inputCopiedBytes += arena.lastTiming.copiedInputBytes;
    this.inputCopyMs += arena.lastTiming.inputCopyMs;
    this.kernelMs += arena.lastTiming.kernelMs;
    this.general.activeSeedCount = out[0];
    this.general.hasActive = out[0] > 0;
    this.red.activeSeedCount = out[1];
    this.red.hasActive = out[1] > 0;
    if (out[2]) {
      this.invalid = true;
      this.notes.add(
        'Non-opaque capture pixels are unsupported; the composited background is unknown.',
      );
    }
  }

  private processDenseJavaScript(words: Uint32Array): void {
    for (let pixel = 0; pixel < words.length; pixel++) {
      const word = words[pixel];
      if (word >>> 24 !== 255) {
        this.invalid = true;
        this.notes.add(
          'Non-opaque capture pixels are unsupported; the composited background is unknown.',
        );
        this.luminance[pixel] = NaN;
        this.redAnchor[pixel] = 0xffffffff;
        this.direction[pixel] = 0;
        this.redPending[pixel] = 0;
        this.previousRgb[pixel] = 0xffffffff;
        this.general.count[pixel] = 0;
        this.red.reset(pixel);
        continue;
      }
      const rgb = word & 0xffffff;
      if (this.previousRgb[pixel] === rgb) continue;
      this.previousRgb[pixel] = rgb;
      const r = linear[rgb & 255],
        g = linear[(rgb >>> 8) & 255],
        b = linear[(rgb >>> 16) & 255];
      this.generalTransition(
        pixel,
        0.2126 * r + 0.7152 * g + 0.0722 * b,
        this.frameIndex,
      );
      if (rgb === 0) {
        this.redAnchor[pixel] = 0xffffffff;
        this.redPending[pixel] = 0;
        this.red.reset(pixel);
      } else {
        const saturated = r / (r + g + b) >= 0.8;
        if (this.redAnchor[pixel] === 0xffffffff) {
          this.redAnchor[pixel] = rgb;
          this.saturated[pixel] = saturated ? 1 : 0;
        } else if (saturated || this.saturated[pixel]) {
          const color = this.colors.slot(rgb);
          this.redTransition(pixel, rgb, color, this.frameIndex);
        }
      }
    }
  }

  private generalTransition(
    pixel: number,
    current: number,
    timestamp: number,
  ): void {
    const anchor = this.luminance[pixel];
    if (!Number.isFinite(anchor)) {
      this.luminance[pixel] = current;
      return;
    }
    const delta = current - anchor;
    const direction = this.direction[pixel];
    if (direction && Math.sign(delta) === direction) {
      this.luminance[pixel] = current; // Track the extremum, including gradual excursions.
      return;
    }
    if (
      Math.abs(delta) + Number.EPSILON < 0.1 ||
      Math.min(current, anchor) >= 0.8
    )
      return;
    this.general.transition(pixel, timestamp);
    this.direction[pixel] = delta > 0 ? 1 : -1;
    this.luminance[pixel] = current;
  }

  private redTransition(
    pixel: number,
    rgb: number,
    color: number,
    timestamp: number,
  ): void {
    const saturated = !!(this.colors.flags[color] & 1);
    const anchor = this.redAnchor[pixel];
    if (anchor === 0xffffffff) {
      this.redAnchor[pixel] = rgb;
      this.saturated[pixel] = saturated ? 1 : 0;
      return;
    }
    if (!(saturated || this.saturated[pixel])) return;
    this.colors.chromaticity(color, rgb);
    // Read current values before looking up the anchor: colliding full-RGB tags
    // may intentionally reuse the same cache slot.
    const u = this.colors.u[color],
      v = this.colors.v[color];
    const previousColor = this.colors.slot(anchor);
    this.colors.chromaticity(previousColor, anchor);
    const du = u - this.colors.u[previousColor];
    const dv = v - this.colors.v[previousColor];
    if (du * du + dv * dv <= 0.2 ** 2) return;
    this.red.transition(
      pixel,
      this.redStart[pixel],
      timestamp,
      this.redPending[pixel] !== 0 &&
        du * this.redDu[pixel] + dv * this.redDv[pixel] < 0,
    );
    this.redPending[pixel] = 1;
    this.redDu[pixel] = du;
    this.redDv[pixel] = dv;
    this.redStart[pixel] = timestamp;
    this.redAnchor[pixel] = rgb;
    this.saturated[pixel] = saturated ? 1 : 0;
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
        downsampled: this.downsampled,
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
        sourceWidth: this.sourceWidth,
        sourceHeight: this.sourceHeight,
        onCandidate: this.onCandidate,
        notes: this.notes,
      },
      history,
      type,
      ended,
    );
  }

  finish(): AnalysisResult {
    if (this.finalized) return structuredClone(this.finalized);
    this.finalized = finishAnalysis({
      last: this.last,
      first: this.first,
      count: this.count,
      invalid: this.invalid,
      interrupted: this.interrupted,
      downsampled: this.downsampled,
      minFps: this.minFps,
      gap: this.gap,
      permittedGap: this.permittedGap,
      notes: this.notes,
      findings: this.findings,
      width: this.width,
      height: this.height,
      sourceWidth: this.sourceWidth,
      sourceHeight: this.sourceHeight,
      stateBytes: this.stateBytes,
    });
    // Final reports retain numeric evidence only; release volatile frame buffers.
    this.diagnosticHistory = undefined;
    return structuredClone(this.finalized);
  }
}
