import { linear } from './color-cache.js';
import { FrameQuality } from './frame-quality.js';
import { FrameTiles } from './frame-tiles.js';
import type { AnalysisBackendStats, AnalysisOptions } from './types.js';
import { EMBEDDED_KERNEL_BYTES } from './wasm-dense.js';
/** Exact dense and sparse pixel transitions share the same temporal histories and failure policy. */
export abstract class FramePixels extends FrameTiles {
  protected readonly quality: FrameQuality;
  protected constructor(options: AnalysisOptions) {
    super(options);
    this.quality = new FrameQuality(options);
  }
  protected abstract markInterrupted(reason?: string): void;
  protected backendFailed = false;
  protected denseFrames = 0;
  protected inputCopiedBytes = 0;
  protected inputCopyMs = 0;
  protected kernelMs = 0;

  protected processDensePacked(words: Uint32Array): void {
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
      this.quality.invalid = true;
      this.quality.notes.add(
        'Non-opaque capture pixels are unsupported; the composited background is unknown.',
      );
    }
  }
  protected processDenseJavaScript(words: Uint32Array): void {
    for (let pixel = 0; pixel < words.length; pixel++) {
      const word = words[pixel];
      if (word >>> 24 !== 255) {
        this.quality.invalid = true;
        this.quality.notes.add(
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
  protected generalTransition(
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
  protected redTransition(
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
  /** Process every changed source pixel through its exact representative. */
  protected processSparse(
    rgba: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    changedRuns?: Uint32Array,
  ): void {
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
        this.quality.invalid = true;
        this.quality.notes.add(
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
}
