import { exampleReport } from '../../apps/web/src/lib/example-report';
/** Deliberately distinct source, DOM and presentation clocks exercise the transport allowlist. */
export function diagnosticPublicationFixture(
  scannerBuildSha256: string,
  localInspectionToken: string,
) {
  const report = structuredClone(exampleReport);
  report.id = `diagnostic-${crypto.randomUUID()}`;
  report.origin = `https://diagnostic-${crypto.randomUUID()}.example.net`;
  report.scannerBuildSha256 = scannerBuildSha256;
  report.routes[0]!.url = `${report.origin}/animation`;
  const originalFinding = report.routes[0]!.scenarios[0]!.findings[0]!;
  const quality = report.routes[0]!.scenarios[0]!.quality;
  quality.spatial = {
    mode: 'NATIVE_PIXELS',
    sourceWidth: quality.width,
    sourceHeight: quality.height,
    retainedResolutionRatio: 1,
    stateBytes: 100000,
    stateBudgetBytes: 256 * 1024 * 1024,
    tileSharing: 'LOSSLESS_IDENTICAL_HISTORY',
    colorAssumption: 'SDR_SRGB_8BIT',
  };
  quality.processing = {
    measuredFrames: quality.frameCount,
    meanMs: 6,
    maxMs: 20,
    framesOver16_7Ms: 1,
    scope: 'WORKER_CONVERSION_AND_ANALYSIS',
    conversionMeanMs: 2,
    analysisMeanMs: 4,
  };
  report.routes[0]!.coverage = [
    {
      id: 'compact-coverage',
      scenario: 'compact',
      outcome: 'UNREACHED',
      viewportMethod: 'CDP',
      reason: 'CSS viewport did not change',
      viewport: { width: 600, height: 400, dpr: 2 },
    },
  ];
  const at = Date.parse(report.startedAt) + 2000;
  originalFinding.sourceTimeline = {
    version: 1,
    status: 'CORRELATED',
    clockBasis: 'FRAME_RECEIPT_ESTIMATE',
    windowStartEpochMs: at,
    windowEndEpochMs: at + 500,
    alignmentUncertaintyMs: null,
    frameClock: {
      method: 'PER_FRAME_RECEIPT',
      matchedFrames: 32,
      receiptOffsetSpreadMs: 13.75,
      startBoundaryErrorMs: 2.5,
      endBoundaryErrorMs: 3.25,
    },
    sampledAt: report.endedAt,
    sampleIntervalMs: 100,
    maxSampleGapMs: 100,
    sampleCount: 2,
    firstSampleEpochMs: at,
    lastSampleEpochMs: at + 100,
    complete: false,
    candidates: [
      {
        id: 'node-1',
        inspectionToken: localInspectionToken,
        selectorPath: ['*:nth-child(1)'],
        tag: 'video',
        media: 'VIDEO',
        observations: [
          {
            atEpochMs: at,
            readWindow: {
              startEpochMs: at - 4,
              endEpochMs: at - 1,
              trigger: 'ANIMATION_FRAME',
              renderEpochMs: at - 6,
            },
            rect: { x: 10, y: 10, width: 100, height: 50 },
            viewport: {
              width: 640,
              height: 360,
              dpr: 1,
              scrollX: 0,
              scrollY: 0,
            },
            mutationsSincePrevious: 0,
            animations: [],
            mediaTimeMs: 3200,
            mediaPaused: false,
            videoPresentation: {
              callbackEpochMs: at - 8,
              presentationEpochMs: at - 12,
              expectedDisplayEpochMs: at + 4,
              mediaTimeMs: 3191.25,
              presentedFrames: 96,
            },
          },
          {
            atEpochMs: at + 100,
            readWindow: {
              startEpochMs: at + 96,
              endEpochMs: at + 99,
              trigger: 'TIMER_FALLBACK',
            },
            rect: { x: 12, y: 10, width: 100, height: 50 },
            viewport: {
              width: 640,
              height: 360,
              dpr: 1,
              scrollX: 0,
              scrollY: 0,
            },
            mutationsSincePrevious: 1,
            animations: [],
            mediaTimeMs: 3300,
            mediaPaused: false,
            videoPresentation: {
              callbackEpochMs: at + 90,
              presentationEpochMs: at + 86,
              expectedDisplayEpochMs: at + 102,
              mediaTimeMs: 3275.5,
              presentedFrames: 98,
            },
          },
        ],
      },
    ],
    limitations: [
      'DOM_TIMELINE_SAMPLE_GAP',
      'TEMPORAL_SPATIAL_CORRELATION_NOT_VERIFIED_CAUSE',
    ],
  };
  return { report, originalFinding };
}
