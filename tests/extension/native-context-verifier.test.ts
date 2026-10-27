import { describe, expect, it } from 'vitest';
import { verifyNativeContextGuard } from './verify-native-context-guard.mjs';

// Fabricated records here test only the evidence checker. They are never stored
// in native evidence or used as claims about an actual browser/capture run.
function record(mode = 'zoom'): any {
  const context = (width = 900, revision = 0) => ({
    documentToken: 'same-document',
    url: 'http://127.0.0.1/',
    viewportRevision: revision,
    viewport: {
      width,
      height: 563,
      dpr: 2,
      visualScale: 1,
      visualOffsetLeft: 0,
      visualOffsetTop: 0,
    },
  });
  const source = {
    id: 'candidate-1',
    type: 'GENERAL_FLASH',
    startMs: 200,
    endMs: 1800,
    region: { x: 200, y: 480, width: 4, height: 4 },
    spatial: {
      componentPixels: 16,
      simultaneousPixels: 16,
      visualField: { basis: 'W3C_CSS_REFERENCE' },
    },
  };
  const guarded = structuredClone(source);
  delete (guarded.spatial as any).visualField;
  const snapshot = (at: number) => ({
    at,
    zoom: 1,
    context: context(),
    tracks: {
      context: 'OPEN',
      streams: [{ active: true, tracks: [{ readyState: 'live' }] }],
    },
    capturedTabs: [{ tabId: 3, status: 'active' }],
  });
  const quality = { frameCount: 200, interrupted: false };
  const evidence = {
    schemaVersion: 1,
    mode,
    errors: [],
    environment: {
      headless: false,
      playwrightAttached: false,
      extensionBuild: {
        productionSha256: 'a'.repeat(64),
        instrumentedSha256: 'b'.repeat(64),
        fixtureSourceSha256: Object.fromEntries(
          ['a', 'b', 'c', 'd', 'e'].map((key) => [key, 'c'.repeat(64)]),
        ),
      },
    },
    job: {
      id: 'job',
      generation: 'gen',
      tabId: 3,
      scannerBuildSha256: 'd'.repeat(64),
      startedAt: new Date(1000).toISOString(),
      state: 'PARTIAL',
      stopReason: 'QUEUE_EXHAUSTED',
      limitations: [],
      tasks: [
        {
          observations: [
            {
              id: 'seg',
              measurement: {
                findings: [guarded],
                quality,
                status: 'NEEDS_REVIEW',
                limitations: ['CSS_REFERENCE_CONTEXT_CHANGED_OR_UNAVAILABLE'],
              },
            },
          ],
        },
      ],
    },
    events: [
      { kind: 'REAL_STREAM_CREATED', at: 800 },
      { kind: 'SEGMENT_BEGIN', segmentId: 'seg', generation: 'gen', at: 1000 },
      {
        kind: 'FRAME_DONE',
        segmentId: 'seg',
        generation: 'gen',
        at: 1100,
        frames: 30,
      },
      {
        kind: 'WORKER_CANDIDATE',
        segmentId: 'seg',
        generation: 'gen',
        at: 1900,
        finding: source,
      },
      { kind: 'SEGMENT_END', segmentId: 'seg', generation: 'gen', at: 4000 },
      {
        kind: 'WORKER_RESULT',
        segmentId: 'seg',
        generation: 'gen',
        at: 4050,
        findings: [source],
      },
    ],
    zoomEvents: [
      { tabId: 3, at: 2250, oldZoomFactor: 1, newZoomFactor: 1.1 },
      { tabId: 3, at: 2450, oldZoomFactor: 1.1, newZoomFactor: 1 },
    ],
    roundTrip: {
      jobId: 'job',
      segmentId: 'seg',
      candidateId: 'candidate-1',
      startedAt: 2000,
      before: snapshot(2100),
      changed: { ...snapshot(2300), zoom: 1.1, context: context(818, 1) },
      after: { ...snapshot(2500), context: context(900, 2) },
      restoredAt: 2600,
    },
    report: {
      scannerBuildSha256: 'd'.repeat(64),
      passed: null,
      status: 'INCONCLUSIVE',
      limitations: ['CSS_REFERENCE_CONTEXT_CHANGED_OR_UNAVAILABLE'],
      routes: [
        {
          scenarios: [
            { id: 'seg', quality, findings: [structuredClone(guarded)] },
          ],
        },
      ],
    },
  };
  if (mode === 'resize') evidence.roundTrip.changed.zoom = 1;
  return evidence;
}

function cancelled(): any {
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

function ownedScan(mode = 'cancel'): any {
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

describe('retained native context evidence verifier', () => {
  it('accepts actual-shape roundtrip evidence and preserves interruption as uncertainty', () => {
    const evidence = record();
    evidence.job.tasks[0].observations[0].measurement.quality.interrupted = true;
    evidence.job.tasks[0].observations[0].measurement.status = 'INCONCLUSIVE';
    const result = verifyNativeContextGuard(evidence);
    expect(result.candidateRetained).toBe(true);
    expect(result.quality.interrupted).toBe(true);
  });
  it('accepts a CSS resize roundtrip and rejects outer-window-only change', () => {
    const evidence = record('resize');
    expect(verifyNativeContextGuard(evidence).cssReferenceRemoved).toBe(true);
    evidence.roundTrip.changed.context.viewport.width = 900;
    expect(() => verifyNativeContextGuard(evidence)).toThrow(
      /Actual CSS resize/,
    );
  });
  it('requires mutation within the same still-active segment', () => {
    const evidence = record();
    evidence.roundTrip.restoredAt = 4100;
    expect(() => verifyNativeContextGuard(evidence)).toThrow();
  });
  it('rejects missing original field, lost candidate, altered counts and reintroduced exported field', () => {
    for (const mutate of [
      (value: any) => {
        delete value.events.find((event: any) => event.kind === 'WORKER_RESULT')
          .findings[0].spatial.visualField;
      },
      (value: any) => {
        value.job.tasks[0].observations[0].measurement.findings = [];
      },
      (value: any) => {
        value.job.tasks[0].observations[0].measurement.findings[0].spatial.componentPixels = 8;
      },
      (value: any) => {
        value.report.routes[0].scenarios[0].findings[0].spatial.visualField = {
          basis: 'W3C_CSS_REFERENCE',
        };
      },
    ]) {
      const evidence = record();
      mutate(evidence);
      expect(() => verifyNativeContextGuard(evidence)).toThrow();
    }
  });
  it('rejects unchanged revisions and missing real browser zoom events', () => {
    const evidence = record();
    evidence.roundTrip.after.context.viewportRevision = 0;
    expect(() => verifyNativeContextGuard(evidence)).toThrow(
      /context revision/,
    );
    const missing = record();
    missing.zoomEvents = [];
    expect(() => verifyNativeContextGuard(missing)).toThrow();
  });
  it('accepts full compact cancellation and explicit offscreen closure', () => {
    const evidence = cancelled();
    expect(verifyNativeContextGuard(evidence).producerReleased).toBe(true);
    evidence.cancellation.after.tracks = { context: 'CLOSED' };
    expect(verifyNativeContextGuard(evidence).trackEvidence).toMatch(
      /context closed/,
    );
  });
  it('cannot disguise a tab-switch intervention as ordinary production cleanup', () => {
    const evidence = cancelled();
    evidence.tabSwitchProbe = { status: 'COMPLETED' };
    expect(() => verifyNativeContextGuard(evidence)).toThrow(
      /ordinary cleanup/,
    );
    evidence.environment.tabSwitchProbe = true;
    evidence.environment.hypothesis = 'POST_DETACH_INFOBAR_CONTAINER_REBIND';
    evidence.environment.productionAcceptance = false;
    evidence.productionAcceptance = false;
    evidence.tabSwitchProbe.status = 'ABORTED';
    expect(() => verifyNativeContextGuard(evidence)).toThrow(/actually run/);
  });
  it('rejects cancellation before any accepted frames or after natural segment completion', () => {
    const evidence = cancelled();
    evidence.cancellation.acceptedFrame.frames = 0;
    expect(() => verifyNativeContextGuard(evidence)).toThrow();
    const ended = cancelled();
    ended.events.push({ kind: 'SEGMENT_END', segmentId: 'seg', at: 1250 });
    expect(() => verifyNativeContextGuard(ended)).toThrow(
      /during the measured compact/,
    );
  });
  it('rejects a live track, missing query, attached debugger, ownership residue or active capture', () => {
    for (const mutate of [
      (value: any) => {
        value.tracks.streams[0].tracks[0].readyState = 'live';
      },
      (value: any) => {
        value.tracks = { context: 'UNRESPONSIVE' };
      },
      (value: any) => {
        value.debuggerAttached = true;
      },
      (value: any) => {
        value.ownershipKeys = ['viewport-workspace:job'];
      },
      (value: any) => {
        value.ownershipKeys = ['pointer-session:3'];
      },
      (value: any) => {
        value.ownershipKeys = ['viewport-rebind:job'];
      },
      (value: any) => {
        value.capturedTabs[0].status = 'active';
      },
    ]) {
      const evidence = cancelled();
      mutate(evidence.cancellation.after);
      expect(() => verifyNativeContextGuard(evidence)).toThrow();
    }
  });
  it('rejects wrong foreground, tab index, surviving workspace or unrecovered CSS layout', () => {
    for (const mutate of [
      (value: any) => {
        value.foregroundTabId = 3;
      },
      (value: any) => {
        value.tab.index = 0;
      },
      (value: any) => {
        value.windowIds.push(9);
      },
      (value: any) => {
        value.context.viewport.height = 400;
      },
    ]) {
      const evidence = cancelled();
      mutate(evidence.cancellation.after);
      expect(() => verifyNativeContextGuard(evidence)).toThrow();
    }
  });
  it('accepts explicitly separated owned cancellation and natural-completion evidence', () => {
    for (const mode of ['cancel', 'complete']) {
      const result = verifyNativeContextGuard(ownedScan(mode));
      expect(result).toMatchObject({
        ownedScan: true,
        originalDocumentPreserved: true,
        ownedScanTabRemoved: true,
        producerReleased: true,
      });
      expect(result.scope).toContain(
        'no legacy original-WebContents restoration',
      );
    }
  });
  it('requires genuine pre-prepare identity, a separate owned tab and no preparation capture', () => {
    for (const mutate of [
      (value: any) => {
        value.environment.extensionBuild.embeddedScannerBuildSha256 =
          'e'.repeat(64);
      },
      (value: any) => {
        value.ownedScan.originalInitial.at = 650;
      },
      (value: any) => {
        value.ownedScan.originalInitial.document.at = -2000;
      },
      (value: any) => {
        value.ownedScan.preparation.at = 1001;
      },
      (value: any) => {
        value.ownedScan.preparation.owner.scanTabId = 2;
      },
      (value: any) => {
        value.ownedScan.preparation.capturedTabs = [
          { tabId: 3, status: 'active' },
        ];
      },
      (value: any) => {
        value.ownedScan.preparation.debuggerTabIds = [2];
      },
      (value: any) => {
        value.job.disposableSource.nonce = 'other-owner';
      },
    ]) {
      const value = ownedScan();
      mutate(value);
      expect(() => verifyNativeContextGuard(value)).toThrow();
    }
  });
  it('rejects replaced documents, altered original context and foreground changes', () => {
    for (const mutate of [
      (original: any) => {
        original.document.documentId = 'replacement-document-id';
      },
      (original: any) => {
        original.document.timeOrigin++;
      },
      (original: any) => {
        original.context.documentToken = 'replacement-content-token';
      },
      (original: any) => {
        original.context.viewportRevision++;
      },
      (original: any) => {
        original.document.height = 450;
      },
      (original: any) => {
        original.context.viewport.height = 450;
      },
      (original: any) => {
        original.tab.url += 'changed';
      },
      (original: any) => {
        original.tab.index++;
      },
      (original: any) => {
        original.window.width++;
      },
      (original: any) => {
        original.tab.active = true;
      },
      (original: any) => {
        original.foregroundTabId = 8;
      },
      (original: any) => {
        original.window.focused = false;
      },
    ]) {
      const value = ownedScan();
      mutate(value.ownedScan.after.original);
      expect(() => verifyNativeContextGuard(value)).toThrow();
    }
  });
  it('requires actual scan/workspace removal and released capture, debugger and ownership', () => {
    for (const mutate of [
      (value: any) => {
        value.tab = { id: 3 };
      },
      (value: any) => {
        value.tabIds.push(3);
      },
      (value: any) => {
        value.windowIds.push(9);
      },
      (value: any) => {
        value.ownershipKeys = ['advanced-scan-owner'];
      },
      (value: any) => {
        value.ownedScanOwner = { phase: 'MANUAL' };
      },
      (value: any) => {
        value.debuggerTabIds = [2];
      },
      (value: any) => {
        value.capturedTabs = [{ tabId: 2, status: 'pending' }];
      },
      (value: any) => {
        value.tracks = { context: 'UNRESPONSIVE' };
      },
      (value: any) => {
        value.tracks.streams[0].tracks[0].readyState = 'live';
      },
      (value: any) => {
        value.at = 1250;
      },
    ]) {
      const value = ownedScan();
      mutate(value.ownedScan.after);
      expect(() => verifyNativeContextGuard(value)).toThrow();
    }
  });
  it('requires measured native compact coverage and natural completion without STOP', () => {
    for (const mutate of [
      (value: any) => {
        value.cancellation = {};
      },
      (value: any) => {
        value.job.stopIntent = true;
      },
      (value: any) => {
        value.job.stopReason = 'USER_STOP';
      },
      (value: any) => {
        value.job.tasks[0].observations[0].achieved = false;
      },
      (value: any) => {
        value.job.tasks[0].observations[0].measurement.quality.effectiveFps = 35;
      },
      (value: any) => {
        value.job.tasks[0].observations[0].measurement.quality.downsampled = true;
      },
      (value: any) => {
        value.ownedScan.compactBefore.snapshot.ownedScanOwner.generation =
          'other';
      },
      (value: any) => {
        value.ownedScan.compactBefore.snapshot.tracks.streams[0].tracks[0].settings.resizeMode =
          'crop-and-scale';
      },
      (value: any) => {
        value.events = value.events.filter(
          (event: any) => event.kind !== 'SEGMENT_END',
        );
      },
    ]) {
      const value = ownedScan('complete');
      mutate(value);
      expect(() => verifyNativeContextGuard(value)).toThrow();
    }
  });
});
