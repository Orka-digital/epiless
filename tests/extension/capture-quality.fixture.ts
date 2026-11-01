import { afterEach, vi } from 'vitest';

import type { AnalysisResult } from '@epi-less/analysis-engine';

export function measurement(): AnalysisResult {
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

export type Response = { ok: boolean; value?: unknown; error?: string };

export type ReaderResult = { done: true } | { done: false; value: FakeFrame };

export type FakeFrame = {
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

export async function captureHarness() {
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
