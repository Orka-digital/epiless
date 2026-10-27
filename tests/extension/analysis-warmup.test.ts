import { expect, it, vi } from 'vitest';
import { WasmDenseArena } from '../../packages/analysis-engine/src/wasm-dense';
import { warmAnalysisRuntime } from '../../apps/chrome-extension/src/analysis-warmup';

it('exercises the actual dense kernel during numeric preparation', () => {
  const process = vi.spyOn(WasmDenseArena.prototype, 'process');
  try {
    warmAnalysisRuntime();
    expect(process.mock.calls.length).toBeGreaterThan(0);
    expect(
      process.mock.calls.every(([words]) => words.length === 64 * 64),
    ).toBe(true);
  } finally {
    process.mockRestore();
  }
});
