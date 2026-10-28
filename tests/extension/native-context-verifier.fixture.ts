import { cancelled } from './native-context-cancel.fixture';

export function ownedScan(mode = 'cancel'): any {
  const value = cancelled();
  value.mode = mode;
  value.environment.ownedScan = true;
  value.environment.extensionBuild.embeddedScannerBuildSha256 =
    value.job.scannerBuildSha256;
  const initial = {
    at: 500,
    tab: {
      id: 2,
      windowId: 5,
      index: 2,
      active: true,
      url: 'http://127.0.0.1/',
      pinned: false,
      groupId: -1,
    },
    window: {
      id: 5,
      width: 900,
      height: 650,
      left: 100,
      top: 50,
      focused: true,
    },
    foregroundTabId: 2,
    zoom: 1,
    document: {
      at: 490,
      documentId: 'independent-original-document',
      url: 'http://127.0.0.1/',
      timeOrigin: 100,
      width: 900,
      height: 507,
      dpr: 2,
    },
    context: null,
  };
  const context = {
    ...structuredClone(value.roundTrip.before.context),
    documentToken: 'actual-original-content-token',
  };
  context.viewport.height = 507;
  const original = {
    ...structuredClone(initial),
    at: 700,
    tab: { ...initial.tab, active: false },
    foregroundTabId: 7,
    context,
  };
  const owner = {
    version: 1,
    nonce: 'opaque-prepared-scan-nonce',
    phase: 'PREPARED',
    createdAt: 600,
    source: {
      tabId: 2,
      windowId: 5,
      index: 2,
      url: initial.document.url,
      context,
      window: { width: 900, height: 650, left: 100, top: 50 },
    },
    scanTabId: 3,
    scanWindowId: 5,
  };
  value.job.disposableSource = {
    nonce: owner.nonce,
    originalTabId: 2,
    originalUrl: initial.document.url,
    closed: true,
    cleanupStatus: 'CLOSED',
  };
  const before = value.cancellation.before;
  Object.assign(before, {
    jobId: value.job.id,
    generation: value.job.generation,
    original: structuredClone(original),
    ownedScanOwner: {
      ...structuredClone(owner),
      phase: 'RUNNING',
      jobId: value.job.id,
      generation: value.job.generation,
    },
    debuggerTabIds: [3],
  });
  before.ownershipKeys.push('advanced-scan-owner');
  before.tracks.streams[0].tracks[0].settings.resizeMode = 'none';
  const after = value.cancellation.after;
  Object.assign(after, {
    tab: null,
    tabIds: [2, 7],
    original: { ...structuredClone(original), at: after.at },
    ownedScanOwner: null,
    debuggerTabIds: [],
  });
  value.ownedScan = {
    version: 1,
    originalInitial: initial,
    preparation: {
      at: 700,
      owner,
      original: structuredClone(original),
      capturedTabs: [],
      debuggerTabIds: [],
    },
    after,
  };
  if (mode === 'complete') {
    value.ownedScan.compactBefore = {
      frame: value.cancellation.acceptedFrame,
      snapshot: before,
    };
    delete value.cancellation;
    value.job.state = 'PARTIAL';
    value.job.stopReason = 'QUEUE_EXHAUSTED';
    value.job.stopIntent = false;
    value.job.tasks[0].observations[0] = {
      id: 'seg',
      scenario: 'compact-viewport',
      achieved: true,
      measurement: {
        quality: {
          frameCount: 300,
          effectiveFps: 60,
          width: 1200,
          height: 800,
          interrupted: false,
          downsampled: false,
        },
      },
    };
    value.events.push({
      kind: 'SEGMENT_END',
      segmentId: 'seg',
      generation: 'gen',
      at: 1500,
    });
  }
  return value;
}
export { cancelled } from './native-context-cancel.fixture';
export { record } from './native-context-record.fixture';
