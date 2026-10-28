import { describe, expect, it } from 'vitest';

import type { AnalysisResult } from '@epi-less/analysis-engine';

import { captureHarness } from './capture-quality.fixture';
describe('capture lifecycle isolation', () => {
  it('releases only one queue slot on frame failure and retains failures arriving during END', async () => {
    const harness = await captureHarness();
    await harness.send('CAPTURE_START');
    await harness.send('SEGMENT_BEGIN');
    const worker = harness.workers[0];
    for (const timestamp of [1000, 2000, 3000]) {
      harness.readers[0].emit({ done: false, value: harness.frame(timestamp) });
      await harness.settle();
    }
    worker.onmessage?.({ data: { type: 'FRAME_ERROR' } });
    for (const timestamp of [4000, 5000]) {
      harness.readers[0].emit({ done: false, value: harness.frame(timestamp) });
      await harness.settle();
    }
    expect(worker.frames).toBe(4);
    worker.errorWhileEnding = true;
    const response = await harness.send('SEGMENT_END');
    expect(response.ok).toBe(true);
    const result = response.value as AnalysisResult;
    expect(result.status).toBe('INCONCLUSIVE');
    expect(result.quality.interrupted).toBe(true);
    expect(result.limitations.join(' ')).toContain(
      '1 queued source/analysis frames failed',
    );
    expect(result.limitations.join(' ')).toContain('3 total frames');
  });
});
