// Fabricated records here test only the evidence checker. They are never stored
// in native evidence or used as claims about an actual browser/capture run.
export function record(mode = 'zoom'): any {
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
