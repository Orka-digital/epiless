import { describe, expect, it } from 'vitest';
import {
  CaptureOwner,
  ExecutionOwner,
  WorkspaceOwner,
} from '../../apps/chrome-extension/src/runner-runtime';

describe('runner ownership', () => {
  it.each(['beginAuthorization', 'beginPreparation'] as const)(
    'releases only its own %s lease',
    (method) => {
      const owner = new ExecutionOwner();
      const releaseOld = owner[method]();
      expect(() => owner[method]()).toThrow();
      releaseOld();
      const releaseNew = owner[method]();
      releaseOld();
      expect(() => owner[method]()).toThrow();
      releaseNew();
      expect(() => owner[method]()).not.toThrow();
    },
  );
  it('does not clear the clock of a replacement generation', () => {
    const owner = new ExecutionOwner();
    owner.startClock({
      id: 'job',
      generation: 'new',
      started: 10,
      priorMs: 20,
    });
    owner.clearClock('old');
    expect(owner.clock?.generation).toBe('new');
    owner.clearClock('new');
    expect(owner.clock).toBeUndefined();
  });
  it('releases failed execution and rejects overlap', async () => {
    const owner = new ExecutionOwner();
    let fail!: (error: Error) => void;
    owner.trackRun(
      () =>
        new Promise<void>((_, reject) => {
          fail = reject;
        }),
    );
    const running = owner.running!;
    let overlapStarted = false;
    expect(() =>
      owner.trackRun(async () => {
        overlapStarted = true;
      }),
    ).toThrow('RUNNER_ALREADY_ACTIVE');
    expect(overlapStarted).toBe(false);
    expect(() => owner.trackRun(() => Promise.resolve())).toThrow(
      'RUNNER_ALREADY_ACTIVE',
    );
    await Promise.resolve();
    fail(new Error('capture failed'));
    await expect(running).rejects.toThrow('capture failed');
    expect(owner.running).toBeUndefined();
    owner.trackRun(() => Promise.resolve());
    await owner.running;
    expect(owner.running).toBeUndefined();
  });
  it('ignores late completion of an earlier capture segment', () => {
    const owner = new CaptureOwner();
    owner.openSegment({
      jobId: 'job',
      generation: 'new',
      segmentId: 'segment',
      events: [],
    });
    owner.closeSegment('old', 'segment');
    owner.closeSegment('new', 'previous');
    expect(owner.activeSegment?.generation).toBe('new');
    owner.closeSegment('new', 'segment');
    expect(owner.activeSegment).toBeUndefined();
  });
  it('does not share browser resources across owner instances', () => {
    const first = new WorkspaceOwner(),
      second = new WorkspaceOwner();
    first.restoreWindows.set('job', { id: 1, width: 1200, height: 800 });
    expect(second.restoreWindows.size).toBe(0);
  });
});
