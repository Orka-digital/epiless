import { describe, expect, it, vi } from 'vitest';

import { FrameAnalyzer } from '../src/index.js';

import { WasmDenseArena } from '../src/wasm-dense.js';
import { pixels } from './wasm-dense.fixture';
describe('exact shared-state WASM dense backend', () => {
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
