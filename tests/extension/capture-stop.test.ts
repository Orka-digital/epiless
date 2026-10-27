import { afterEach, describe, expect, it, vi } from 'vitest';
import { stopRequestedCapture } from '../../apps/chrome-extension/src/capture-stop';
import {
  DEFAULT_LIMITS,
  TERMINAL_STATES,
  type ScanJob,
} from '../../apps/chrome-extension/src/model';

afterEach(() => vi.useRealTimers());

function job(state: ScanJob['state'] = 'RUNNING'): ScanJob {
  return {
    id: 'old-dashboard-job',
    tabId: 17,
    origin: 'https://example.test',
    startUrl: 'https://example.test/',
    startedAt: '2026-10-27T10:00:00Z',
    updatedAt: '2026-10-27T10:00:00Z',
    state,
    stopIntent: false,
    generation: 'requested-lease',
    elapsedMs: 0,
    mode: 'AUTONOMOUS',
    skippedLinks: 0,
    limitations: [],
    limits: { ...DEFAULT_LIMITS },
    tasks: [],
  };
}
function fixture(value: ScanJob | undefined, running = true) {
  let activeGeneration = 'another-active-lease';
  let currentCaptureStopped = false;
  const stoppedProducers: string[] = [];
  const options = {
    id: 'old-dashboard-job',
    type: 'STOP' as 'STOP' | 'PAUSE',
    running,
    now: () => '2026-10-27T10:01:00Z',
    // Like IndexedDB mutateJob, returning an existing terminal job does NOT
    // imply that its mutation callback actually changed the lease.
    mutate: vi.fn(async (_id: string, update: (job: ScanJob) => void) => {
      if (value) update(value);
      return value;
    }),
    cancel: vi.fn(async (_tabId: number) => {}),
    stop: vi.fn(async (generation: string) => {
      if (generation === activeGeneration) {
        currentCaptureStopped = true;
        stoppedProducers.push(generation);
      }
    }),
  };
  return {
    options,
    stoppedProducers,
    setActiveGeneration: (generation: string) => {
      activeGeneration = generation;
      currentCaptureStopped = false;
    },
    get currentCaptureStopped() {
      return currentCaptureStopped;
    },
  };
}

describe('STOP/PAUSE capture lease ownership', () => {
  it.each(TERMINAL_STATES)(
    'ignores stale requests for an existing %s job while another producer is active',
    async (state) => {
      for (const type of ['STOP', 'PAUSE'] as const) {
        const previous = job(state),
          before = structuredClone(previous);
        const f = fixture(previous);
        f.options.type = type;
        await stopRequestedCapture(f.options);
        expect(previous).toEqual(before);
        expect(f.options.cancel).not.toHaveBeenCalled();
        expect(f.options.stop).not.toHaveBeenCalled();
        expect(f.currentCaptureStopped).toBe(false);
      }
    },
  );

  it('ignores a missing/deleted job rather than stopping the current capture', async () => {
    const f = fixture(undefined);
    await stopRequestedCapture(f.options);
    expect(f.options.cancel).not.toHaveBeenCalled();
    expect(f.options.stop).not.toHaveBeenCalled();
    expect(f.currentCaptureStopped).toBe(false);
  });

  it('persists STOPPING before cancelling content and stops only the mutated generation', async () => {
    const current = job();
    const f = fixture(current);
    f.setActiveGeneration(current.generation);
    f.options.cancel.mockImplementation(async (tabId) => {
      expect(tabId).toBe(current.tabId);
      expect(current.state).toBe('STOPPING');
      expect(current.stopIntent).toBe(true);
      expect(f.options.stop).toHaveBeenCalledExactlyOnceWith('requested-lease');
    });
    await stopRequestedCapture(f.options);
    expect(current.stopReason).toBe('USER_STOP');
    expect(current.endedAt).toBeUndefined();
    expect(f.options.stop).toHaveBeenCalledExactlyOnceWith('requested-lease');
    expect(f.currentCaptureStopped).toBe(true);
  });

  it('handles an authorization abort without a running loop and cannot stop a replacement producer during asynchronous cancellation', async () => {
    const current = job('AUTHORIZING');
    const f = fixture(current, false);
    f.setActiveGeneration(current.generation);
    f.options.cancel.mockImplementation(async () => {
      expect(current.state).toBe('PARTIAL');
      expect(current.endedAt).toBe(f.options.now());
      f.setActiveGeneration('replacement-lease');
    });
    await stopRequestedCapture(f.options);
    expect(f.options.stop).toHaveBeenCalledExactlyOnceWith('requested-lease');
    expect(f.stoppedProducers).toEqual(['requested-lease']);
    expect(f.currentCaptureStopped).toBe(false);
  });

  it('preserves pause semantics and lets a later STOP terminate the paused lease', async () => {
    const current = job();
    const f = fixture(current);
    f.options.type = 'PAUSE';
    await stopRequestedCapture(f.options);
    expect(current.state).toBe('PAUSED');
    expect(current.stopReason).toBe('USER_PAUSE');
    expect(current.endedAt).toBeUndefined();
    f.options.type = 'STOP';
    f.options.running = false;
    await stopRequestedCapture(f.options);
    expect(current.state).toBe('PARTIAL');
    expect(current.stopReason).toBe('USER_STOP');
    expect(current.endedAt).toBe(f.options.now());
    expect(f.options.stop.mock.calls).toEqual([
      ['requested-lease'],
      ['requested-lease'],
    ]);
  });

  it('still releases its own capture if page cancellation rejects', async () => {
    const f = fixture(job());
    f.options.cancel.mockRejectedValue(new Error('Tab was closed'));
    await stopRequestedCapture(f.options);
    expect(f.options.stop).toHaveBeenCalledExactlyOnceWith('requested-lease');
  });

  it('does not issue browser side effects when the persistence transaction fails', async () => {
    const f = fixture(job());
    f.options.mutate.mockRejectedValue(new Error('Transaction aborted'));
    await expect(stopRequestedCapture(f.options)).rejects.toThrow(
      'Transaction aborted',
    );
    expect(f.options.cancel).not.toHaveBeenCalled();
    expect(f.options.stop).not.toHaveBeenCalled();
  });

  it('closes ordinary capture immediately while content cancellation remains unresolved', async () => {
    const f = fixture(job());
    let finish!: () => void;
    f.options.cancel.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const stopped = stopRequestedCapture(f.options);
    await Promise.resolve();
    await Promise.resolve();
    expect(f.options.stop).toHaveBeenCalledExactlyOnceWith('requested-lease');
    finish();
    await stopped;
  });

  it.each(['STOP', 'PAUSE'] as const)(
    'acknowledges %s after at most 1000ms of unanswered content cancellation, without stopping a replacement lease',
    async (type) => {
      vi.useFakeTimers();
      const current = job();
      const f = fixture(current);
      f.options.type = type;
      f.setActiveGeneration(current.generation);
      let rejectCancel!: (error: Error) => void;
      f.options.cancel.mockImplementation(
        () => new Promise<void>((_resolve, reject) => (rejectCancel = reject)),
      );
      let acknowledged = false;
      const stopping = stopRequestedCapture(f.options).then(() => {
        acknowledged = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(f.stoppedProducers).toEqual(['requested-lease']);
      f.setActiveGeneration('replacement-lease');
      await vi.advanceTimersByTimeAsync(999);
      expect(acknowledged).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await stopping;
      expect(acknowledged).toBe(true);
      expect(f.currentCaptureStopped).toBe(false);
      // A late port failure is consumed and cannot issue another producer stop.
      rejectCancel(new Error('Late content port closure'));
      await Promise.resolve();
      expect(f.options.stop).toHaveBeenCalledExactlyOnceWith('requested-lease');
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('bounds only content cancellation and still waits for the producer-stop reply', async () => {
    vi.useFakeTimers();
    const f = fixture(job());
    let releaseCapture!: () => void;
    f.options.stop.mockImplementation(
      () => new Promise<void>((resolve) => (releaseCapture = resolve)),
    );
    f.options.cancel.mockImplementation(() => new Promise<void>(() => {}));
    let acknowledged = false;
    const stopping = stopRequestedCapture(f.options).then(() => {
      acknowledged = true;
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(acknowledged).toBe(false);
    releaseCapture();
    await stopping;
    expect(acknowledged).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the cancellation deadline when the page responds promptly', async () => {
    vi.useFakeTimers();
    await stopRequestedCapture(fixture(job()).options);
    expect(vi.getTimerCount()).toBe(0);
  });
});
