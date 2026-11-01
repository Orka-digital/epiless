import { describe, expect, it } from 'vitest';

import type { AnalysisResult } from '@epi-less/analysis-engine';

import { captureHarness } from './capture-quality.fixture';
describe('capture lifecycle isolation', () => {
  it('stops a late getUserMedia result after cancellation instead of resurrecting capture', async () => {
    const harness = await captureHarness();
    const release = harness.delayNextStart();
    const starting = harness.send('CAPTURE_START');
    await harness.settle();
    await harness.send('CAPTURE_STOP');
    release();
    expect((await starting).error).toContain('CAPTURE_SOURCE_START_CANCELLED');
    expect(harness.tracks[0].stop).toHaveBeenCalledOnce();
    expect(harness.workers).toHaveLength(0);
  });

  it('an older asynchronous source failure cannot stop a replacement in the same scan generation', async () => {
    const harness = await captureHarness();
    const release = harness.delayNextStart();
    const old = harness.send('CAPTURE_START', 'one', { sourceId: 'old' });
    await harness.settle();
    expect(
      (await harness.send('CAPTURE_START', 'one', { sourceId: 'new' })).ok,
    ).toBe(true);
    release();
    expect((await old).error).toContain('CAPTURE_SOURCE_START_CANCELLED');
    expect(harness.tracks[0].stop).toHaveBeenCalledOnce();
    expect(harness.tracks[1].stop).not.toHaveBeenCalled();
    await harness.send('CAPTURE_STOP', 'one', { sourceId: 'old' });
    expect(harness.tracks[1].stop).not.toHaveBeenCalled();
    expect(
      (await harness.send('SEGMENT_BEGIN', 'one', { sourceId: 'old' })).ok,
    ).toBe(false);
    expect(
      (await harness.send('SEGMENT_BEGIN', 'one', { sourceId: 'new' })).ok,
    ).toBe(true);
  });

  it('preserves the failed native geometry constraint without exposing device identifiers', async () => {
    const harness = await captureHarness();
    await harness.send('CAPTURE_START');
    const failure = Object.assign(new Error('Cannot satisfy constraints'), {
      constraint: 'width',
    });
    harness.failConstraints(failure);
    const response = await harness.send('SEGMENT_BEGIN', 'one', {
      expectedViewport: { width: 600, height: 507, dpr: 2 },
    });
    expect(response.ok).toBe(false);
    expect(response.error).toContain('CAPTURE_VIEWPORT_CONSTRAINT_FAILED');
    expect(response.error).toContain('"constraint":"width"');
    expect(response.error).toContain('"requested":{"width":1200,"height":1014');
    expect(response.error).toContain('"settings":{"width":1800,"height":1014');
    expect(response.error).not.toContain('must-not-be-recorded');
    expect(response.error).not.toContain('deviceId');
    expect(harness.workers[0].requests).toEqual([]);
  });

  it('reports unexpected reader EOF but not intentional cancellation', async () => {
    const harness = await captureHarness();
    expect((await harness.send('CAPTURE_START')).ok).toBe(true);
    harness.readers[0].emit({ done: true });
    await harness.settle();
    expect(harness.notifications).toHaveBeenCalledWith({
      target: 'background',
      type: 'CAPTURE_LOST',
      generation: 'one',
      sourceId: 'one-source',
      reason: 'FRAME_READER_ENDED',
    });
    harness.notifications.mockClear();
    await harness.send('CAPTURE_START', 'two');
    await harness.send('CAPTURE_STOP', 'two');
    await harness.settle();
    expect(harness.notifications).not.toHaveBeenCalled();
  });

  it('old worker callbacks cannot unlock or interrupt a newer capture', async () => {
    const harness = await captureHarness();
    await harness.send('CAPTURE_START');
    const stale = harness.workers[0];
    await harness.send('CAPTURE_START', 'two');
    await harness.send('SEGMENT_BEGIN', 'two');
    const current = harness.workers[1];
    for (const timestamp of [1000, 2000, 3000]) {
      harness.readers[1].emit({ done: false, value: harness.frame(timestamp) });
      await harness.settle();
    }
    stale.onmessage?.({ data: { type: 'FRAME_DONE' } });
    stale.onerror?.();
    harness.readers[1].emit({ done: false, value: harness.frame(4000) });
    await harness.settle();
    expect(current.frames).toBe(3);
    expect(harness.notifications).not.toHaveBeenCalled();
    current.onmessage?.({ data: { type: 'FRAME_DONE' } });
    harness.readers[1].emit({ done: false, value: harness.frame(5000) });
    await harness.settle();
    expect(current.frames).toBe(4);
  });

  it('closes a late frame from a cancelled reader without submitting it to the new worker', async () => {
    const harness = await captureHarness();
    await harness.send('CAPTURE_START');
    const staleReader = harness.readers[0];
    staleReader.cancelEmitsEnd = false;
    await harness.send('CAPTURE_START', 'two');
    await harness.send('SEGMENT_BEGIN', 'two');
    const staleFrame = harness.frame();
    staleReader.emit({ done: false, value: staleFrame });
    await harness.settle();
    expect(staleFrame.close).toHaveBeenCalledOnce();
    expect(harness.workers[1].frames).toBe(0);
    expect(harness.notifications).not.toHaveBeenCalled();
  });

  it('releases backpressure after transfer failure and measures actual segment coverage', async () => {
    const harness = await captureHarness();
    await harness.send('CAPTURE_START');
    await harness.send('SEGMENT_BEGIN');
    harness.workers[0].failFrame = true;
    const rejected = harness.frame();
    harness.readers[0].emit({ done: false, value: rejected });
    await harness.settle();
    expect(rejected.close).toHaveBeenCalledOnce();
    harness.workers[0].failFrame = false;
    harness.time(500);
    harness.readers[0].emit({ done: false, value: harness.frame(2000) });
    await harness.settle();
    expect(harness.workers[0].frames).toBe(1);
    harness.time(2000);
    const response = await harness.send('SEGMENT_END');
    expect(response.ok).toBe(true);
    expect((response.value as AnalysisResult).quality).toMatchObject({
      captureWindowMs: 2000,
      leadingIdleMs: 500,
      trailingIdleMs: 1500,
      interrupted: true,
    });
  });

  it('bounds the backlog at three actual frames, closes excess frames and preserves FIFO timestamps', async () => {
    const harness = await captureHarness();
    await harness.send('CAPTURE_START');
    await harness.send('SEGMENT_BEGIN');
    const worker = harness.workers[0];
    for (const timestamp of [1000, 2000, 3000, 4000]) {
      const frame = harness.frame(timestamp);
      harness.readers[0].emit({ done: false, value: frame });
      await harness.settle();
      expect(frame.close).toHaveBeenCalledOnce();
    }
    expect(worker.frames).toBe(3);
    worker.onmessage?.({ data: { type: 'FRAME_DONE' } });
    harness.readers[0].emit({ done: false, value: harness.frame(5000) });
    await harness.settle();
    expect(
      worker.requests
        .filter((r) => r.type === 'FRAME')
        .map((r) => r.timestampMs),
    ).toEqual([1, 2, 3, 5]);
    const response = await harness.send('SEGMENT_END');
    expect(response.ok).toBe(true);
    expect((response.value as AnalysisResult).quality.interrupted).toBe(true);
    expect((response.value as AnalysisResult).limitations.join(' ')).toContain(
      '1 source/analysis frames were skipped',
    );
    expect(worker.requests.at(-1)?.type).toBe('END');
  });
});
