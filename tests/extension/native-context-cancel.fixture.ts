import { record } from './native-context-record.fixture';

export function cancelled(): any {
  const evidence = record('cancel');
  evidence.events = evidence.events.filter(
    (value: any) => value.kind !== 'SEGMENT_END',
  );
  evidence.job.stopReason = 'USER_STOP';
  const originalWindow = { width: 900, height: 650, left: 100, top: 50 };
  const before = {
    ...evidence.roundTrip.before,
    at: 1200,
    jobState: 'RUNNING',
    pendingAction: 'compact-viewport',
    tab: { id: 3, windowId: 9, active: true, index: 0 },
    window: { focused: false },
    originalWindow: { ...originalWindow, id: 5, focused: true },
    foregroundTabId: 7,
    ownershipKeys: ['viewport-workspace:job', 'pointer-session:3'],
    debuggerAttached: true,
    workspace: {
      tabId: 3,
      windowId: 9,
      originalWindowId: 5,
      originalIndex: 2,
      originalWindow,
    },
  };
  const restoredContext = structuredClone(before.context);
  before.context = structuredClone(before.context);
  before.context.viewport.width = 600;
  before.context.viewport.height = 400;
  before.tracks.streams[0].tracks[0].settings = { width: 1200, height: 800 };
  evidence.events.find(
    (event: any) => event.kind === 'SEGMENT_BEGIN',
  ).referenceMapping = { viewport: { width: 600, height: 400, dpr: 2 } };
  evidence.cancellation = {
    jobId: 'job',
    segmentId: 'seg',
    scenario: 'compact-viewport',
    acceptedFrame: evidence.events.find(
      (event: any) => event.kind === 'FRAME_DONE',
    ),
    before,
    stopRequestedAt: 1300,
    after: {
      ...before,
      context: restoredContext,
      at: 1800,
      tab: { id: 3, windowId: 5, active: false, index: 2 },
      windowIds: [5],
      workspace: null,
      ownershipKeys: [],
      debuggerAttached: false,
      capturedTabs: [{ tabId: 3, status: 'stopped' }],
      tracks: {
        context: 'OPEN',
        streams: [{ active: false, tracks: [{ readyState: 'ended' }] }],
      },
    },
  };
  evidence.geometryBeforeStart = { at: 900, width: 900, height: 563, dpr: 2 };
  return evidence;
}
