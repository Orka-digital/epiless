import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameAnalyzer } from '../../packages/analysis-engine/src/index';
import { createRunnerObservation } from '../../apps/chrome-extension/src/runner-observation';
import {
  CaptureOwner,
  WorkspaceOwner,
} from '../../apps/chrome-extension/src/runner-runtime';
import type { ObservationServices } from '../../apps/chrome-extension/src/observation-services';
import type { ScanJob } from '../../apps/chrome-extension/src/model';
const stored = vi.hoisted(() => ({ job: undefined as ScanJob | undefined }));
vi.mock('../../apps/chrome-extension/src/store', () => ({
  getJob: async () => stored.job,
  mutateJob: async (_id: string, change: (job: ScanJob) => void) => {
    change(stored.job!);
    return stored.job;
  },
}));
const url = 'https://example.com/';
const context = {
  documentToken: 'doc',
  viewport: { width: 64, height: 64, dpr: 1, visualScale: 1 },
  url,
};
beforeEach(() => {
  stored.job = {
    id: 'job',
    generation: 'generation',
    tabId: 1,
    startUrl: url,
    mode: 'QUICK',
    tasks: [{ id: 'task', observations: [], reasons: [] }],
  } as unknown as ScanJob;
  vi.stubGlobal('chrome', {
    tabs: {
      get: vi.fn().mockResolvedValue({ url }),
      getZoom: vi.fn().mockResolvedValue(1),
    },
  });
});
function setup(result: unknown = new FrameAnalyzer().finish()) {
  const capture = new CaptureOwner();
  const content = vi.fn(
    async (_id: string, _generation: string, type: string) =>
      type === 'FG_DIAGNOSTIC_CONTEXT' ? context : undefined,
  );
  const offscreen = vi.fn(async (type: string) =>
    type === 'SEGMENT_END' ? result : undefined,
  );
  const services = {
    guard: async () => stored.job!,
    now: () => new Date().toISOString(),
    content,
    observedUrl: (value: string | undefined, fallback: string) =>
      value ?? fallback,
    recordUnobserved: async () => undefined,
    prepareCaptureSource: async () => 'source',
    guardedWait: async () => undefined,
    offscreen,
    errorText: (error: unknown) => String(error),
    capture,
    workspace: new WorkspaceOwner(),
  } as unknown as ObservationServices;
  return {
    runner: createRunnerObservation(services),
    offscreen,
    content,
    capture,
  };
}
describe('observation capture lifecycle', () => {
  it('closes a captured segment before persisting the completed observation', async () => {
    const { runner, offscreen, capture } = setup();
    await runner.observe('job', 'generation', 'task', 'idle', 10);
    expect(offscreen.mock.calls.map((call) => call[0])).toEqual([
      'SEGMENT_BEGIN',
      'SEGMENT_END',
    ]);
    expect(stored.job!.tasks[0].observations[0].measurement).toBeDefined();
    expect(stored.job!.tasks[0].pendingAction).toBeUndefined();
    expect(capture.activeSegment).toBeUndefined();
  });
  it('keeps valid partial evidence and finalizes resources when an action is cancelled', async () => {
    const { runner, offscreen, capture } = setup();
    await expect(
      runner.observe('job', 'generation', 'task', 'action', 10, async () => {
        throw new Error('CANCELLED');
      }),
    ).rejects.toThrow('CANCELLED');
    const observation = stored.job!.tasks[0].observations[0];
    expect(observation.achieved).toBe(false);
    expect(observation.measurement).toBeDefined();
    expect(
      offscreen.mock.calls.filter((call) => call[0] === 'SEGMENT_END'),
    ).toHaveLength(1);
    expect(capture.activeSegment).toBeUndefined();
  });
  it('never stores a malformed worker result as a successful measurement', async () => {
    const { runner, capture } = setup({
      status: 'NO_ISSUES_OBSERVED',
      passed: true,
    });
    await expect(
      runner.observe('job', 'generation', 'task', 'idle', 10),
    ).rejects.toThrow('INVALID_MEASUREMENT_RESULT');
    const observation = stored.job!.tasks[0].observations[0];
    expect(observation.achieved).toBe(false);
    expect(observation.measurement).toBeUndefined();
    expect(observation.coverage).toBe('UNREACHED');
    expect(capture.activeSegment).toBeUndefined();
  });
});
