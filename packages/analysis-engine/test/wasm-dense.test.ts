import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrameAnalyzer } from '../src/index.js';
import { EMBEDDED_KERNEL_BYTES, WasmDenseArena } from '../src/wasm-dense.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pixels(width: number, height: number, frame: number, uniform = false) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const phase = Math.floor(frame / 5) % 2;
  for (let p = 0; p < width * height; p++) {
    const n = uniform ? 10 : ((p * 37) ^ (p >>> 2)) & 63;
    rgba[p * 4] = n + phase * 180;
    rgba[p * 4 + 1] = n + phase * 180;
    rgba[p * 4 + 2] = n + phase * 180;
    if (p % 3 === 0 && !uniform) {
      rgba[p * 4] = phase ? 255 : 0;
      rgba[p * 4 + 1] = phase ? 0 : 255;
      rgba[p * 4 + 2] = 0;
    }
    rgba[p * 4 + 3] = 255;
  }
  return rgba;
}

function state(analyzer: FrameAnalyzer) {
  const internal = analyzer as unknown as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of [
    'frameTimes',
    'luminance',
    'direction',
    'redAnchor',
    'saturated',
    'redPending',
    'redDu',
    'redDv',
    'redStart',
    'previousRgb',
    'representatives',
    'queue',
    'previousFrame',
    'tileUniform',
    'tilePeers',
    'tileDependents',
    'tileCandidates',
    'tileCandidateCounts',
    'frameIndex',
    'representativeCount',
    'tilesPrepared',
    'invalid',
    'interrupted',
    'count',
    'first',
    'last',
    'gap',
  ])
    output[key] = internal[key];
  for (const kind of ['general', 'red']) {
    const history = internal[kind] as Record<string, unknown>;
    output[kind] = Object.fromEntries(
      Object.entries(history).filter(([key]) => key !== 'times'),
    );
  }
  return output;
}

function sameState(actual: unknown, expected: unknown, label: string): void {
  if (ArrayBuffer.isView(expected)) {
    if (
      !ArrayBuffer.isView(actual) ||
      actual.constructor !== expected.constructor
    )
      throw new Error(`${label}: different typed-array kind`);
    const a = actual as unknown as ArrayLike<number>;
    const b = expected as unknown as ArrayLike<number>;
    if (a.length !== b.length) throw new Error(`${label}: different length`);
    for (let i = 0; i < a.length; i++)
      if (!Object.is(a[i], b[i]))
        throw new Error(`${label}[${i}]: ${a[i]} versus ${b[i]}`);
  } else if (expected && typeof expected === 'object') {
    const b = expected as Record<string, unknown>;
    const a = actual as Record<string, unknown>;
    expect(Object.keys(a)).toEqual(Object.keys(b));
    for (const key of Object.keys(b))
      sameState(a[key], b[key], `${label}/${key}`);
  } else if (!Object.is(actual, expected))
    throw new Error(`${label}: different scalar state`);
}

describe('exact shared-state WASM dense backend', () => {
  it('preserves every temporal value and live diagnostic across JS/WASM transitions, alpha, gaps and resized epochs', () => {
    const eventsA: unknown[] = [],
      eventsB: unknown[] = [];
    const a = new FrameAnalyzer({
      backend: 'JS',
      maxPixels: 20 * 17,
      onCandidate: (f) => eventsA.push(structuredClone(f)),
    });
    const b = new FrameAnalyzer({
      maxPixels: 20 * 17,
      onCandidate: (f) => eventsB.push(structuredClone(f)),
    });
    for (let frame = 0; frame < 150; frame++) {
      const width = frame < 125 ? 19 : 20;
      const input = pixels(
        width,
        17,
        frame,
        frame < 20 || (frame >= 75 && frame < 85),
      );
      if (frame >= 40 && frame < 43) input[3] = 120;
      if (frame >= 45 && frame < 48) input.fill(0, 0, 3);
      const unaligned = new Uint8Array(
        new ArrayBuffer(input.byteLength + 1),
        1,
      );
      unaligned.set(input);
      const rgba = frame % 3 === 0 ? unaligned : input;
      const sample = {
        rgba,
        width,
        height: 17,
        timestampMs: (frame * 1000) / 60 + (frame >= 100 ? 150 : 0),
        sourceWidth: frame >= 110 ? width * 2 : width,
        sourceHeight: 17,
      };
      a.pushFrame(sample);
      b.pushFrame(sample);
      sameState(state(b), state(a), `state after frame ${frame}`);
      expect(eventsB, `callbacks after frame ${frame}`).toEqual(eventsA);
      if (frame === 135) {
        a.markInterrupted('Test reset');
        b.markInterrupted('Test reset');
      }
    }
    const stats = b.getBackendStats();
    expect(stats.backend).toBe('WASM_DENSE');
    expect(stats.denseFrames).toBeGreaterThan(0);
    expect(stats.inputCopiedBytes).toBeGreaterThan(0);
    expect(stats.embeddedKernelBytes).toBe(EMBEDDED_KERNEL_BYTES);
    const expected = a.finish();
    expected.quality.spatial!.stateBytes += stats.extraStateBytes;
    expect(b.finish()).toEqual(expected);
    expect(eventsB.length).toBeGreaterThan(0);
  });

  it('executes partially shared frames without touching alias state, including tile forks, alpha and red histories', () => {
    const width = 32,
      height = 16;
    const eventsA: unknown[] = [],
      eventsB: unknown[] = [];
    const a = new FrameAnalyzer({
      backend: 'JS',
      maxPixels: width * height,
      onCandidate: (f) => eventsA.push(structuredClone(f)),
    });
    const b = new FrameAnalyzer({
      maxPixels: width * height,
      onCandidate: (f) => eventsB.push(structuredClone(f)),
    });
    const process = WasmDenseArena.prototype.process;
    let mixedCalls = 0,
      overSeedCapacity = false;
    const observed = vi
      .spyOn(WasmDenseArena.prototype, 'process')
      .mockImplementation(function (this: WasmDenseArena, words, frame) {
        const representatives = this.views.representatives as Uint32Array;
        const count = representatives.reduce(
          (total, value, index) => total + (value === index ? 1 : 0),
          0,
        );
        if (count > words.length / 2 && count < words.length) mixedCalls++;
        const result = process.call(this, words, frame);
        if (result[0] > 256 || result[1] > 256) overSeedCapacity = true;
        return result;
      });
    try {
      for (let frame = 0; frame < 150; frame++) {
        const rgba = pixels(width, height, frame, frame < 20 || frame >= 140);
        if (frame >= 20 && frame < 140) {
          const phase = Math.floor(frame / 5) % 2;
          // One uniform tile plus one exact duplicate tile: most pixels remain
          // independent, but the previous all-or-nothing WASM guard rejected it.
          for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++) {
              const at = (y * width + x) * 4;
              const value = frame >= 45 && frame < 48 ? 0 : phase ? 230 : 10;
              rgba[at] = rgba[at + 1] = rgba[at + 2] = value;
              rgba[at + 3] = frame >= 40 && frame < 43 ? 120 : 255;
              const from = (y * width + x + 8) * 4;
              rgba.set(rgba.subarray(from, from + 4), (y * width + x + 16) * 4);
            }
          // Fork a formerly aliased pixel; its full prior history must first be
          // copied by prepareTiles, then processed exactly once by the kernel.
          if (frame >= 60 && frame < 65) rgba[0] = 90 + frame;
        }
        const input = {
          rgba,
          width,
          height,
          timestampMs: (frame * 1000) / 60 + (frame >= 120 ? 150 : 0),
        };
        a.pushFrame(input);
        b.pushFrame(input);
        sameState(state(b), state(a), `mixed state after frame ${frame}`);
        expect(eventsB).toEqual(eventsA);
      }
      expect(mixedCalls).toBeGreaterThan(0);
      expect(overSeedCapacity).toBe(true);
      expect(eventsB.length).toBeGreaterThan(0);
      const expected = a.finish();
      expected.quality.spatial!.stateBytes +=
        b.getBackendStats().extraStateBytes;
      expect(b.finish()).toEqual(expected);
    } finally {
      observed.mockRestore();
    }
  });

  it('uses a stable direct input without copying, preserves input across resets and retains cumulative counters', () => {
    const a = new FrameAnalyzer({ maxPixels: 19 * 17, diagnostics: false });
    a.prepare(19, 17);
    const input = a.getInputRgba()!;
    expect(input).toBeInstanceOf(Uint8ClampedArray);
    for (let f = 0; f < 8; f++) {
      input.set(pixels(19, 17, f));
      a.pushFrame({
        rgba: input,
        width: 19,
        height: 17,
        timestampMs: f * 20 + (f >= 4 ? 150 : 0),
      });
      expect(a.getInputRgba()).toBe(input);
      expect(input).toEqual(pixels(19, 17, f));
    }
    expect(a.getBackendStats().denseFrames).toBe(8);
    expect(a.getBackendStats().inputCopiedBytes).toBe(0);
    a.markInterrupted('Test counter preservation');
    expect(a.getBackendStats().denseFrames).toBe(8);
    expect(a.getInputRgba()).toBe(input);
    expect(Object.isFrozen(a.getBackendStats())).toBe(true);
  });

  it('counts retained pages, migrated payload and embedded bytes without duplicate temporal state', () => {
    const js = new FrameAnalyzer({ backend: 'JS', maxPixels: 1920 * 1080 });
    const wasm = new FrameAnalyzer({ maxPixels: 1920 * 1080 });
    // Small geometry proves the accounting identity without allocating a native
    // frame in the routine suite; the retained 1080 proof records full budgets.
    js.prepare(19, 17);
    wasm.prepare(19, 17);
    const baseline = js.getBackendStats(),
      stats = wasm.getBackendStats();
    expect(stats.wasmMemoryBytes % 65536).toBe(0);
    expect(stats.wasmMemoryBytes - stats.migratedStateBytes).toBe(
      stats.extraStateBytes,
    );
    expect(stats.engineStateBytes).toBe(
      baseline.engineStateBytes + stats.extraStateBytes,
    );
    expect(stats.engineStateBytes).toBeLessThan(256 * 1024 * 1024);
    expect(baseline.embeddedKernelBytes).toBe(EMBEDDED_KERNEL_BYTES);
    expect(js.getInputRgba()).toBeUndefined();
    expect(baseline.selectionReason).toBe('FORCED_JS');
  });

  it('falls back to JS only when initialization is unavailable before capture', () => {
    vi.stubGlobal('WebAssembly', undefined);
    const auto = new FrameAnalyzer(),
      js = new FrameAnalyzer({ backend: 'JS' });
    const sample = {
      rgba: pixels(19, 17, 0),
      width: 19,
      height: 17,
      timestampMs: 0,
    };
    auto.pushFrame(sample);
    js.pushFrame(sample);
    expect(auto.getBackendStats().selectionReason).toBe('UNAVAILABLE');
    expect(auto.getInputRgba()).toBeUndefined();
    expect(auto.finish()).toEqual(js.finish());
  });

  it('does not retain an old arena when pre-observation re-preparation falls back', () => {
    const a = new FrameAnalyzer();
    a.prepare(19, 17);
    const old = a.getInputRgba()!.buffer;
    vi.spyOn(WebAssembly, 'Instance').mockImplementation(() => {
      throw new Error('Initialization unavailable');
    });
    a.prepare(20, 17);
    expect(a.getBackendStats().backend).toBe('JS');
    expect(
      (a as unknown as { frameTimes: Float64Array }).frameTimes.buffer,
    ).not.toBe(old);
  });

  it('resets a partially modified kernel state, marks interruption and never retries the same frame through JS', () => {
    const a = new FrameAnalyzer({ diagnostics: false });
    a.prepare(19, 17);
    const js = vi.spyOn(
      a as unknown as { processDenseJavaScript(words: Uint32Array): void },
      'processDenseJavaScript',
    );
    vi.spyOn(WasmDenseArena.prototype, 'process').mockImplementation(function (
      this: WasmDenseArena,
    ) {
      this.views.luminance[0] = 0.123;
      throw new WebAssembly.RuntimeError('Test partial-state trap');
    });
    expect(() =>
      a.pushFrame({
        rgba: pixels(19, 17, 0),
        width: 19,
        height: 17,
        timestampMs: 0,
      }),
    ).toThrow('Test partial-state trap');
    expect(js).not.toHaveBeenCalled();
    expect(
      (a as unknown as { luminance: Float64Array }).luminance[0],
    ).toBeNaN();
    expect(a.getBackendStats().denseFrames).toBe(0);
    vi.restoreAllMocks();
    expect(() =>
      a.pushFrame({
        rgba: pixels(19, 17, 1),
        width: 19,
        height: 17,
        timestampMs: 20,
      }),
    ).toThrow('Analysis backend failed');
    expect(a.finish().status).toBe('INCONCLUSIVE');
  });

  it('throws rather than changing backend after observation has started', () => {
    const a = new FrameAnalyzer();
    a.pushFrame({
      rgba: pixels(19, 17, 0),
      width: 19,
      height: 17,
      timestampMs: 0,
    });
    vi.spyOn(WebAssembly, 'Instance').mockImplementation(() => {
      throw new Error('Later allocation failed');
    });
    expect(() =>
      a.pushFrame({
        rgba: pixels(20, 17, 1),
        width: 20,
        height: 17,
        timestampMs: 20,
      }),
    ).toThrow('Later allocation failed');
    expect(a.getBackendStats().selectionReason).toBe('READY');
    vi.restoreAllMocks();
    expect(() =>
      a.pushFrame({
        rgba: pixels(20, 17, 2),
        width: 20,
        height: 17,
        timestampMs: 40,
      }),
    ).toThrow('Analysis backend failed');
    expect(a.finish().status).toBe('INCONCLUSIVE');
  });
});
