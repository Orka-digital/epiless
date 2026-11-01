import type { WasmDenseArena } from './wasm-dense.js';
// Half-open rolling windows avoid endpoint double counting.
const WITHIN_ROLLING_SECOND_MS = 1000 - 1e-6;
/** Retain bounded alternating-transition history using actual source timestamps. */
export class TransitionHistory {
  readonly starts: Uint16Array;
  readonly count: Uint8Array;
  readonly next: Uint8Array;
  readonly active: Uint8Array;
  hasActive = false;
  activeCount = 0;
  earliestActive = Infinity;
  readonly activeSeeds: Uint32Array;
  activeSeedCount = 0;
  firstActive = Infinity;
  lastActive = -1;
  constructor(
    readonly pixels: number,
    private readonly times: Float64Array,
    arena?: WasmDenseArena,
  ) {
    this.starts =
      (arena?.views.gstarts as Uint16Array | undefined) ??
      new Uint16Array(pixels * 7);
    this.count =
      (arena?.views.gcount as Uint8Array | undefined) ?? new Uint8Array(pixels);
    this.next =
      (arena?.views.gnext as Uint8Array | undefined) ?? new Uint8Array(pixels);
    this.active =
      (arena?.views.gactive as Uint8Array | undefined) ??
      new Uint8Array(pixels);
    this.activeSeeds =
      (arena?.views.gseeds as Uint32Array | undefined) ?? new Uint32Array(256);
  }
  transition(pixel: number, frame: number): void {
    this.starts[pixel * 7 + this.next[pixel]] = frame;
    this.next[pixel] = (this.next[pixel] + 1) % 7;
    this.count[pixel] = Math.min(7, this.count[pixel] + 1);
    if (
      this.count[pixel] === 7 &&
      this.times[frame] - this.started(pixel) < WITHIN_ROLLING_SECOND_MS
    ) {
      this.active[pixel] = 1;
      this.hasActive = true;
      if (this.activeSeedCount < this.activeSeeds.length)
        this.activeSeeds[this.activeSeedCount] = pixel;
      this.activeSeedCount++;
    }
  }
  started(pixel: number): number {
    return this.times[this.starts[pixel * 7 + this.next[pixel]]];
  }
}
/** Retain opposing-pair history without joining unsupported temporal epochs. */
export class OpposingPairHistory {
  readonly starts: Uint16Array;
  readonly previous: Uint16Array;
  readonly tripleEndingPrevious: Uint16Array;
  readonly candidateStarts: Uint16Array;
  readonly active: Uint8Array;
  hasActive = false;
  activeCount = 0;
  earliestActive = Infinity;
  readonly activeSeeds: Uint32Array;
  activeSeedCount = 0;
  firstActive = Infinity;
  lastActive = -1;
  constructor(
    pixels: number,
    private readonly times: Float64Array,
    arena?: WasmDenseArena,
  ) {
    this.starts =
      (arena?.views.rstarts as Uint16Array | undefined) ??
      new Uint16Array(pixels * 3);
    this.previous =
      (arena?.views.rprevious as Uint16Array | undefined) ??
      new Uint16Array(pixels * 3);
    this.tripleEndingPrevious =
      (arena?.views.rtriple as Uint16Array | undefined) ??
      new Uint16Array(pixels);
    this.candidateStarts =
      (arena?.views.rcandidate as Uint16Array | undefined) ??
      new Uint16Array(pixels);
    this.active =
      (arena?.views.ractive as Uint8Array | undefined) ??
      new Uint8Array(pixels);
    this.activeSeeds =
      (arena?.views.rseeds as Uint32Array | undefined) ?? new Uint32Array(256);
  }
  transition(
    pixel: number,
    started: number,
    ended: number,
    opposing: boolean,
  ): void {
    const offset = pixel * 3;
    const tripleStart = this.tripleEndingPrevious[pixel];
    this.tripleEndingPrevious[pixel] = opposing ? this.previous[offset + 1] : 0;
    if (
      opposing &&
      this.times[ended] - this.times[tripleStart] < WITHIN_ROLLING_SECOND_MS
    ) {
      this.active[pixel] = 1;
      this.hasActive = true;
      if (this.activeSeedCount < this.activeSeeds.length)
        this.activeSeeds[this.activeSeedCount] = pixel;
      this.activeSeedCount++;
      this.candidateStarts[pixel] = tripleStart;
    }
    // A disjoint pair cannot reuse a transition from an earlier pair. Unlike
    // the streaming DP, the regression oracle exhaustively enumerates pairs.
    for (let pairs = 2; pairs >= 0; pairs--) {
      const old = this.starts[offset + pairs];
      if (opposing)
        this.starts[offset + pairs] = Math.max(
          old,
          pairs === 0 ? started : this.previous[offset + pairs - 1],
        );
      this.previous[offset + pairs] = old;
    }
  }
  started(pixel: number): number {
    return this.times[this.candidateStarts[pixel]];
  }
  reset(pixel: number): void {
    this.starts.fill(0, pixel * 3, pixel * 3 + 3);
    this.previous.fill(0, pixel * 3, pixel * 3 + 3);
    this.tripleEndingPrevious[pixel] = 0;
    this.candidateStarts[pixel] = 0;
  }
}
