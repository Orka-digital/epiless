import {
  SourceTimelineBuffer,
  type SourceTimelineEvent,
  type TimelineSnapshot,
} from '../../apps/chrome-extension/src/source-timeline-core';

export const base = 1_798_536_000_000;

const context = {
  url: 'https://example.test/private-path?private-secret#private-fragment',
  documentToken: 'private-document-token',
  viewportRevision: 0,
  viewport: {
    width: 800,
    height: 600,
    dpr: 1,
    scrollX: 0,
    scrollY: 0,
    visualScale: 1,
    visualOffsetLeft: 0,
    visualOffsetTop: 0,
  },
};

export const event = (id = 'candidate-1'): SourceTimelineEvent => ({
  generation: 'generation',
  segmentId: 'segment',
  findingId: id,
  windowStartMs: 100,
  windowEndMs: 900,
  windowStartEpochMs: base + 100,
  windowEndEpochMs: base + 900,
  clockBasis: 'FRAME_RECEIPT_ESTIMATE',
  alignmentUncertaintyMs: null,
  analysis: { width: 320, height: 240 },
  source: { width: 800, height: 600 },
  region: { x: 40, y: 40, width: 80, height: 40 },
});

export function snapshot(
  ms: number,
  change: Partial<TimelineSnapshot> = {},
): TimelineSnapshot {
  return {
    atEpochMs: base + ms,
    context: structuredClone(context),
    limitations: [],
    targets: [
      {
        id: 'candidate-node',
        inspectionToken: '11223344-5566-4788-9911-aabbccddeeff',
        selectorPath: ['*:nth-child(1) > *:nth-child(2) > *:nth-child(1)'],
        tag: 'video',
        media: 'VIDEO',
        rect: { x: 100, y: 100, width: 200, height: 100 },
        mutationsSincePrevious: ms === 500 ? 1 : 0,
        animations: [
          {
            kind: 'CSS_ANIMATION',
            playState: 'running',
            durationMs: 200,
            delayMs: 0,
            iterations: null,
            currentTimeMs: ms,
            progress: (ms % 200) / 200,
            properties: ['opacity'],
          },
        ],
        mediaTimeMs: ms + 3000,
        mediaPaused: false,
      },
    ],
    ...change,
  };
}

export function buffer() {
  return new SourceTimelineBuffer('generation', 'segment', context);
}

export function result() {
  const b = buffer();
  for (let ms = 0; ms <= 1000; ms += 100) b.add(snapshot(ms));
  b.record(event());
  return b.finish(new Date(base + 1000).toISOString())['candidate-1']!;
}
