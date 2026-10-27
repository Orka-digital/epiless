import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisResult } from '@epi-less/analysis-engine';
import {
  CaptureCoverage,
  withCaptureCoverage,
} from '../../apps/chrome-extension/src/capture-quality';

function measurement(): AnalysisResult {
  return {
    status: 'NO_ISSUES_OBSERVED',
    passed: null,
    quality: {
      frameCount: 73,
      effectiveFps: 60,
      maxGapMs: 1000 / 60,
      width: 320,
      height: 180,
      downsampled: false,
      interrupted: false,
    },
    findings: [],
    limitations: [],
  };
}

describe('decoded frame coverage of the complete capture window', () => {
  it('does not let a short 60 fps burst hide a long silent tail', () => {
    const coverage = new CaptureCoverage(100);
    for (let frame = 0; frame <= 72; frame++)
      coverage.frameSubmitted(100 + (frame * 1000) / 60);
    const result = withCaptureCoverage(measurement(), coverage.finish(15100));
    expect(result.status).toBe('INCONCLUSIVE');
    expect(result.quality).toMatchObject({
      captureWindowMs: 15000,
      leadingIdleMs: 0,
      trailingIdleMs: 13800,
      frameCount: 73,
      effectiveFps: 60,
      interrupted: true,
    });
    expect(result.limitations.join(' ')).toContain(
      'Static source suppression and capture loss cannot be distinguished',
    );
  });

  it('exposes delayed first-frame timing without moving candidate timestamps', () => {
    const coverage = new CaptureCoverage(100);
    coverage.frameSubmitted(1100);
    coverage.frameSubmitted(2100);
    const original = measurement();
    const result = withCaptureCoverage(original, coverage.finish(2110));
    expect(result.quality.leadingIdleMs).toBe(1000);
    expect(result.quality.trailingIdleMs).toBe(10);
    expect(result.limitations.join(' ')).toContain(
      'relative to the first analyzed decoded frame, not the scenario start',
    );
    expect(original.quality.interrupted).toBe(false);
    expect(original.limitations).toEqual([]);
  });

  it('distinguishes no submitted frames from a complete short boundary gap', () => {
    const empty = withCaptureCoverage(
      measurement(),
      new CaptureCoverage(0).finish(15000),
    );
    expect(empty.quality).toMatchObject({
      captureWindowMs: 15000,
      leadingIdleMs: 15000,
      trailingIdleMs: 15000,
      interrupted: true,
    });
    expect(empty.limitations[0]).toContain('No decoded source frame');

    const coverage = new CaptureCoverage(0);
    for (let frame = 0; frame <= 72; frame++)
      coverage.frameSubmitted(100 + (frame * 1000) / 60);
    const complete = withCaptureCoverage(measurement(), coverage.finish(1400));
    expect(complete.status).toBe('NO_ISSUES_OBSERVED');
    expect(complete.quality.interrupted).toBe(false);
    expect(complete.quality.frameCount).toBe(73);
  });
});

type Response = { ok: boolean; value?: unknown; error?: string };
type ReaderResult = { done: true } | { done: false; value: FakeFrame };
type FakeFrame = {
  displayWidth: number;
  displayHeight: number;
  timestamp: number;
  close: ReturnType<typeof vi.fn>;
};
let shutdown: (() => Promise<unknown>) | undefined;

afterEach(async () => {
  await shutdown?.();
  shutdown = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function captureHarness() {
  vi.resetModules();
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  let listener: (
    message: unknown,
    sender: { id: string },
    respond: (value: Response) => void,
  ) => void;
  const notifications = vi.fn(async () => ({}));
  let constraintFailure: Error | undefined;
  let pendingStart: Promise<void> | undefined;
  const tracks: { stop: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'local-extension',
      getURL: (path: string) => path,
      onMessage: {
        addListener: (value: typeof listener) => (listener = value),
      },
      sendMessage: notifications,
    },
  });
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: () => void;
    failFrame = false;
    errorWhileEnding = false;
    frames = 0;
    requests: { type: string; timestampMs?: number }[] = [];
    constructor() {
      workers.push(this);
    }
    terminate() {}
    postMessage(message: {
      type: string;
      id?: string;
      timestampMs?: number;
      interruption?: string;
    }) {
      this.requests.push(message);
      if (message.type === 'FRAME') {
        if (this.failFrame) throw new Error('Transfer failed');
        this.frames++;
        return;
      }
      queueMicrotask(() => {
        if (message.type === 'END' && this.errorWhileEnding)
          this.onmessage?.({ data: { type: 'FRAME_ERROR' } });
        const result = message.type === 'END' ? measurement() : undefined;
        if (result && message.interruption) {
          result.status = 'INCONCLUSIVE';
          result.quality.interrupted = true;
          result.limitations.push(message.interruption);
        }
        this.onmessage?.({
          data: {
            id: message.id,
            ok: true,
            value: result,
          },
        });
      });
    }
  }
  vi.stubGlobal('Worker', FakeWorker);
  const readers: FakeReader[] = [];
  class FakeReader {
    cancelEmitsEnd = true;
    pending: ((value: ReaderResult) => void)[] = [];
    read() {
      return new Promise<ReaderResult>((resolve) => this.pending.push(resolve));
    }
    async cancel() {
      if (this.cancelEmitsEnd)
        this.pending.splice(0).forEach((resolve) => resolve({ done: true }));
    }
    emit(value: ReaderResult) {
      const resolve = this.pending.shift();
      if (!resolve) throw new Error('No pending frame read');
      resolve(value);
    }
  }
  vi.stubGlobal(
    'MediaStreamTrackProcessor',
    class {
      readable: { getReader: () => FakeReader };
      constructor() {
        const reader = new FakeReader();
        readers.push(reader);
        this.readable = { getReader: () => reader };
      }
    },
  );
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => {
        const delayed = pendingStart;
        pendingStart = undefined;
        const track = {
          applyConstraints: async () => {
            if (constraintFailure) throw constraintFailure;
          },
          getSettings: () => ({
            width: 1800,
            height: 1014,
            deviceId: 'must-not-be-recorded',
          }),
          getCapabilities: () => ({
            width: { min: 1, max: 1800 },
            height: { min: 1, max: 1014 },
            deviceId: 'must-not-be-recorded',
          }),
          stop: vi.fn(),
          onended: null,
        };
        tracks.push(track);
        if (delayed) await delayed;
        return {
          active: true,
          getVideoTracks: () => [track],
          getTracks: () => [track],
        };
      },
    },
  });
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage() {},
        getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      }),
    }),
  });
  await import('../../apps/chrome-extension/src/offscreen');
  const send = (
    type: string,
    generation = 'one',
    extra: Record<string, unknown> = {},
  ) =>
    new Promise<Response>((resolve) =>
      listener(
        {
          target: 'offscreen',
          type,
          generation,
          streamId: 'stream',
          ...(type === 'CAPTURE_STOP'
            ? {}
            : { sourceId: `${generation}-source` }),
          ...extra,
        },
        { id: 'local-extension' },
        resolve,
      ),
    );
  shutdown = () => send('CAPTURE_STOP', '');
  const frame = (timestamp = 1000): FakeFrame => ({
    displayWidth: 1,
    displayHeight: 1,
    timestamp,
    close: vi.fn(),
  });
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  return {
    send,
    workers,
    readers,
    notifications,
    tracks,
    delayNextStart: () => {
      let release!: () => void;
      pendingStart = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    frame,
    settle,
    time: (value: number) => (now = value),
    failConstraints: (error: Error) => {
      constraintFailure = error;
    },
  };
}

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
