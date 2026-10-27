import type { Finding } from '@epi-less/core';

type RecordFrame = { timestamp: number; raw: boolean; data: Uint32Array };
const MEMORY_LIMIT = 16 * 1024 * 1024;
const LITTLE_ENDIAN =
  new Uint8Array(new Uint32Array([0x11223344]).buffer)[0] === 0x44;

/** Lossless bounded frame history. Unchanged pixels and homogeneous changed runs
 * cost no repeated full-frame copy. Complex frames fall back to raw RGBA, with
 * explicitly incomplete traces when the 16 MiB/96-frame window must be evicted.
 * All buffers remain volatile; only one numeric pixel trace enters a finding. */
export class DiagnosticHistory {
  private readonly frames: RecordFrame[] = [];
  private readonly scratch = new Uint32Array(16383); // <64 KiB, bounded encoder work
  private bytes = 0;
  /** Triples [start,end,RGBA] of exactly changed pixels, or undefined for raw frames. */
  changedRuns: Uint32Array | undefined;
  changed = true;
  readonly allocatedBytes = MEMORY_LIMIT + this.scratch.byteLength;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  push(
    rgba: Uint8Array | Uint8ClampedArray,
    timestamp: number,
    previous?: Uint32Array,
  ): void {
    const words =
      rgba.byteOffset % 4 === 0
        ? new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.byteLength / 4)
        : new Uint32Array(new Uint8Array(rgba).buffer);
    let raw = !previous || !this.frames.length;
    let used = 0;
    if (!raw) {
      for (let p = 0; p < words.length;) {
        if (words[p] === previous![p]) {
          p++;
          continue;
        }
        const start = p,
          color = words[p++];
        while (
          p < words.length &&
          words[p] === color &&
          words[p] !== previous![p]
        )
          p++;
        if (
          used + 3 > this.scratch.length ||
          (used + 3) * 4 >= rgba.byteLength
        ) {
          raw = true;
          break;
        }
        this.scratch[used++] = start;
        this.scratch[used++] = p;
        this.scratch[used++] = color;
      }
    }
    const needed = (raw ? rgba.byteLength : used * 4) + 8;
    while (
      this.frames.length > 1 &&
      (this.frames.length >= 96 || this.bytes + needed > MEMORY_LIMIT)
    )
      this.evict();
    // If a raw frame cannot coexist with the current base, drop the old epoch.
    // Native 1080p fits two raw frames; larger dimensions are rejected upstream.
    if (this.frames.length && this.bytes + needed > MEMORY_LIMIT) {
      this.frames.length = 0;
      this.bytes = 0;
      raw = true;
    }
    const data = raw ? words.slice() : this.scratch.slice(0, used);
    this.changedRuns = raw ? undefined : data;
    this.changed = raw || data.length > 0;
    this.frames.push({ timestamp, raw, data });
    this.bytes += data.byteLength + 8;
  }
  private evict(): void {
    const first = this.frames.shift()!,
      next = this.frames[0];
    this.bytes -= first.data.byteLength + 8;
    if (!next.raw) {
      const base = first.data;
      for (let i = 0; i < next.data.length; i += 3)
        base.fill(next.data[i + 2], next.data[i], next.data[i + 1]);
      this.bytes += base.byteLength - next.data.byteLength;
      next.data = base;
      next.raw = true;
    }
  }
  evidence(
    pixel: number,
    started: number,
    ended: number,
    sourceWidth: number,
    sourceHeight: number,
  ): NonNullable<Finding['diagnostic']> {
    const samples: NonNullable<Finding['diagnostic']>['samples'] = [];
    let color = 0,
      opaque = true;
    for (const frame of this.frames) {
      if (frame.timestamp > ended) break;
      if (frame.raw) color = frame.data[pixel];
      else {
        // Runs are disjoint and sorted; binary search does not decompress images.
        let lo = 0,
          hi = frame.data.length / 3 - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >>> 1,
            at = mid * 3;
          if (pixel < frame.data[at]) hi = mid - 1;
          else if (pixel >= frame.data[at + 1]) lo = mid + 1;
          else {
            color = frame.data[at + 2];
            break;
          }
        }
      }
      const alpha = LITTLE_ENDIAN ? color >>> 24 : color & 255;
      if (alpha !== 255) {
        opaque = false;
        continue;
      }
      samples.push({
        timestampMs: frame.timestamp,
        red: LITTLE_ENDIAN ? color & 255 : color >>> 24,
        green: LITTLE_ENDIAN ? (color >>> 8) & 255 : (color >>> 16) & 255,
        blue: LITTLE_ENDIAN ? (color >>> 16) & 255 : (color >>> 8) & 255,
      });
    }
    const complete =
      opaque &&
      samples.length >= 2 &&
      samples[0].timestampMs < started &&
      samples.at(-1)!.timestampMs === ended;
    const omissions: string[] = [];
    if (!complete)
      omissions.push(
        'The bounded sample history does not retain the full detecting window and preceding sample.',
      );
    if (!opaque)
      omissions.push(
        'Non-opaque samples were omitted because the composited background is unknown.',
      );
    return {
      version: 1,
      coordinateSpace: 'ANALYSIS_PIXELS',
      point: { x: pixel % this.width, y: Math.floor(pixel / this.width) },
      analysisWidth: this.width,
      analysisHeight: this.height,
      sourceWidth,
      sourceHeight,
      windowStartMs: started,
      windowEndMs: ended,
      complete,
      samples,
      ...(omissions.length ? { omissions } : {}),
    };
  }
}
