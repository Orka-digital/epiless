import { describe, expect, it } from 'vitest';
import { sourceTimelineSchema } from '../../packages/core/src/source-timeline-schema';
import {
  copySourceTimeline,
  sourceRepairClues,
  renderFindingDiagnostics,
} from '../../packages/core/src/diagnostics';
import {
  SourceTimelineBuffer,
  type SourceTimelineEvent,
  type TimelineSnapshot,
} from '../../apps/chrome-extension/src/source-timeline-core';
import { attachSourceTimelines } from '../../apps/chrome-extension/src/collect-diagnostics';
import { exampleReport } from '../../apps/web/src/lib/example-report';
import {
  auditReportSchema,
  validatePublicReport,
} from '../../packages/core/src/report';

const base = 1_798_536_000_000;
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
const event = (id = 'candidate-1'): SourceTimelineEvent => ({
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
function snapshot(
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
function buffer() {
  return new SourceTimelineBuffer('generation', 'segment', context);
}
function result() {
  const b = buffer();
  for (let ms = 0; ms <= 1000; ms += 100) b.add(snapshot(ms));
  b.record(event());
  return b.finish(new Date(base + 1000).toISOString())['candidate-1']!;
}

describe('temporal DOM evidence', () => {
  it('retains render-phase read windows and real media presentation metadata with a deep public allowlist', () => {
    const b = buffer();
    for (let ms = 0; ms <= 1000; ms += 25) {
      const s = snapshot(ms);
      s.targets[0]!.readWindow = {
        startEpochMs: base + ms - 1,
        endEpochMs: base + ms,
        trigger: 'ANIMATION_FRAME',
        renderEpochMs: base + ms - 2,
      };
      s.targets[0]!.videoPresentation = {
        callbackEpochMs: base + ms - 5,
        presentationEpochMs: base + ms - 6,
        expectedDisplayEpochMs: base + ms + 10,
        mediaTimeMs: ms + 2500,
        presentedFrames: ms / 25,
      };
      b.add(s);
    }
    b.record({
      ...event(),
      frameClock: {
        method: 'PER_FRAME_RECEIPT',
        matchedFrames: 49,
        receiptOffsetSpreadMs: 12,
        startBoundaryErrorMs: 0,
        endBoundaryErrorMs: 0,
      },
    });
    const value = sourceTimelineSchema.parse(
      b.finish(new Date(base + 1000).toISOString())['candidate-1'],
    );
    expect(value.candidates[0]!.observations).toHaveLength(41);
    expect(value.maxSampleGapMs).toBe(25);
    expect(value.complete).toBe(true);
    const observation = value.candidates[0]!.observations[0]!;
    Object.assign(value.frameClock!, { privateSource: 'private-clock' });
    Object.assign(observation.readWindow!, { text: 'private-text' });
    Object.assign(observation.videoPresentation!, { url: 'private-video' });
    const copy = copySourceTimeline(value);
    expect(JSON.stringify(copy)).not.toContain('private-');
    expect(sourceTimelineSchema.safeParse(copy).success).toBe(true);
    expect(sourceRepairClues(copy.candidates[0]!).join(' ')).toContain(
      'geen bewezen overeenkomst',
    );
    copy.candidates[0]!.observations[0]!.readWindow!.endEpochMs = base + 100;
    expect(sourceTimelineSchema.safeParse(copy).success).toBe(false);
  });
  it('joins historic DOM samples to estimated frame window and keeps unknown latency explicit', () => {
    const value = sourceTimelineSchema.parse(result());
    expect(value.status).toBe('CORRELATED');
    expect(value.complete).toBe(true);
    expect(value.alignmentUncertaintyMs).toBeNull();
    expect(value.maxSampleGapMs).toBe(100);
    expect(value.candidates[0]!.observations).toHaveLength(11);
    expect(value.candidates[0]!.observations[5]).toMatchObject({
      mutationsSincePrevious: 1,
      mediaTimeMs: 3500,
    });
    expect(value.limitations).toContain(
      'TEMPORAL_SPATIAL_CORRELATION_NOT_VERIFIED_CAUSE',
    );
    expect(JSON.stringify(value)).not.toContain('private-');
  });
  it('uses each historical viewport after scroll instead of requiring the final scroll position', () => {
    const b = buffer();
    for (let ms = 0; ms <= 1000; ms += 100) {
      const value = snapshot(ms);
      value.context.viewport.scrollY = ms < 500 ? 0 : 600;
      // Fixed overlay remains in the captured region while document scroll changes.
      b.add(value);
    }
    b.record(event());
    const value = b.finish(new Date(base + 1000).toISOString())['candidate-1']!;
    expect(value.complete).toBe(true);
    expect(
      new Set(value.candidates[0]!.observations.map((o) => o.viewport.scrollY)),
    ).toEqual(new Set([0, 600]));
  });
  it('does not confuse a replacement node at the same structural path with the previous source', () => {
    const b = buffer();
    for (let ms = 0; ms <= 1000; ms += 100) {
      const value = snapshot(ms);
      if (ms >= 500) value.targets[0]!.id = 'replacement-node';
      b.add(value);
    }
    b.record(event());
    const value = b.finish(new Date(base + 1000).toISOString())['candidate-1']!;
    expect(value.candidates).toHaveLength(2);
    expect(value.candidates.map((c) => c.observations.length).sort()).toEqual([
      5, 6,
    ]);
  });
  it('does not correlate elements observed only before or after the detecting window despite complete snapshot coverage', () => {
    for (const targetTime of [0, 1000]) {
      const b = buffer();
      for (let ms = 0; ms <= 1000; ms += 100)
        b.add(snapshot(ms, ms === targetTime ? {} : { targets: [] }));
      b.record(event());
      const value = sourceTimelineSchema.parse(
        b.finish(new Date(base + 1000).toISOString())['candidate-1'],
      );
      expect(value.sampleCount).toBe(11);
      expect(value.maxSampleGapMs).toBe(100);
      expect(value.status).toBe('UNAVAILABLE');
      expect(value.complete).toBe(false);
      expect(value.candidates).toEqual([]);
      expect(value.reason).toBe(
        'OVERLAPPING_TARGETS_ONLY_OUTSIDE_DETECTING_WINDOW',
      );
    }
  });
  it('uses the actual DOM read interval for overlap and retains outside-window context only for an in-window node', () => {
    const b = buffer();
    for (let ms = 0; ms <= 1000; ms += 100) {
      const s = snapshot(ms);
      s.targets[0]!.animations = [];
      s.targets[0]!.mutationsSincePrevious = 0;
      if (ms === 0 || ms === 1000) {
        s.targets[0]!.animations = snapshot(ms).targets[0]!.animations;
        s.targets[0]!.mutationsSincePrevious = 1;
      }
      if (ms === 100) {
        const prior = structuredClone(s.targets[0]!);
        prior.id = 'read-before-window';
        prior.readWindow = {
          startEpochMs: base + 90,
          endEpochMs: base + 99,
          trigger: 'EVENT',
        };
        s.targets.push(prior);
      }
      b.add(s);
    }
    b.record(event());
    const value = sourceTimelineSchema.parse(
      b.finish(new Date(base + 1000).toISOString())['candidate-1'],
    );
    expect(value.complete).toBe(true);
    expect(value.candidates).toHaveLength(1);
    expect(value.candidates[0]!.observations).toHaveLength(11);
    const clues = sourceRepairClues(value.candidates[0]!, value).join(' ');
    expect(clues).not.toContain('licht- of kleurgerelateerde');
    expect(clues).not.toContain('Tijdens dit venster wijzigde');
    expect(clues).toContain('3.10–3.90 s');
    const finding = structuredClone(
      exampleReport.routes[0]!.scenarios[0]!.findings[0]!,
    );
    finding.sourceTimeline = value;
    const html = renderFindingDiagnostics(finding);
    expect(html).toContain('context buiten het detectievenster');
    expect(html).not.toContain('licht- of kleurgerelateerde');
  });
  it('rejects cross-document, route, zoom and unsupported aspect-ratio samples rather than attributing stale geometry', () => {
    for (const mutate of [
      (s: TimelineSnapshot) => {
        s.context.documentToken = 'reloaded';
      },
      (s: TimelineSnapshot) => {
        s.context.url = 'https://example.test/changed';
      },
      (s: TimelineSnapshot) => {
        s.context.viewport.visualScale = 2;
      },
      (s: TimelineSnapshot) => {
        s.context.viewport.width = 400;
      },
      (s: TimelineSnapshot) => {
        s.context.viewport.width = 400;
        s.context.viewport.height = 300;
      },
      (s: TimelineSnapshot) => {
        s.context.viewport.dpr = 2;
      },
    ]) {
      const b = buffer();
      for (let ms = 0; ms <= 1000; ms += 100) {
        const s = snapshot(ms);
        mutate(s);
        b.add(s);
      }
      b.record(event());
      const value = b.finish(new Date(base + 1000).toISOString())[
        'candidate-1'
      ]!;
      expect(value.status).toBe('UNAVAILABLE');
      expect(value.complete).toBe(false);
      expect(value.candidates).toEqual([]);
    }
  });
  it('marks transient viewport changes incomplete even when all sampled dimensions have returned to their initial values', () => {
    const b = buffer();
    for (let ms = 0; ms <= 1000; ms += 100) {
      const s = snapshot(ms);
      // Two resize events happened between retained samples. Width, height,
      // DPR and visual viewport values now look identical to the initial ones.
      s.context.viewportRevision = ms < 500 ? 0 : 2;
      b.add(s);
    }
    b.record(event());
    const value = sourceTimelineSchema.parse(
      b.finish(new Date(base + 1000).toISOString())['candidate-1'],
    );
    expect(value.status).toBe('CORRELATED');
    expect(value.complete).toBe(false);
    expect(value.limitations).toContain(
      'VIEWPORT_CONTEXT_REVISION_CHANGED_DURING_WINDOW',
    );
    expect(value.candidates[0]!.observations).toHaveLength(5);
    expect(
      value.candidates[0]!.observations.every(
        (observation) => observation.atEpochMs < base + 500,
      ),
    ).toBe(true);
  });
  it('marks delayed callbacks and missing sampled context incomplete without synthesizing evidence', () => {
    const b = buffer();
    b.add(snapshot(0));
    b.add(snapshot(500));
    b.add(snapshot(1000));
    b.record(event());
    const value = b.finish(new Date(base + 1000).toISOString())['candidate-1']!;
    expect(value.complete).toBe(false);
    expect(value.maxSampleGapMs).toBe(500);
    expect(value.candidates[0]!.observations).toHaveLength(3);
    expect(value.limitations).toContain('DOM_TIMELINE_SAMPLE_GAP');
    const stale = buffer();
    stale.add(snapshot(5000));
    stale.record(event());
    expect(
      stale.finish(new Date(base + 5000).toISOString())['candidate-1']!.reason,
    ).toBe('NO_SAMPLES_NEAR_DETECTING_WINDOW');
  });
  it('bounds event retention and ignores stale generations and malformed frame regions', () => {
    const b = buffer();
    b.add(snapshot(500));
    expect(b.record({ ...event(), generation: 'old' })).toBe(false);
    expect(
      b.record({ ...event(), region: { x: 319, y: 0, width: 10, height: 10 } }),
    ).toBe(false);
    for (let i = 0; i < 12; i++)
      expect(b.record(event(`candidate-${i}`))).toBe(i < 8);
    expect(
      Object.keys(b.finish(new Date(base + 1000).toISOString())),
    ).toHaveLength(8);
  });
  it('deeply strips inspection authority and unknown nested fields when sharing', () => {
    const value = result();
    const token = value.candidates[0]!.inspectionToken!;
    const injected = value as unknown as Record<string, unknown>;
    injected.url = 'private-url';
    (
      value.candidates[0]!.observations[0] as unknown as Record<string, unknown>
    ).text = 'private-text';
    const copy = copySourceTimeline(value);
    const json = JSON.stringify(copy);
    expect(json).not.toContain(token);
    expect(json).not.toContain('private-');
    expect(sourceTimelineSchema.safeParse(copy).success).toBe(true);
    expect(value.candidates[0]!.inspectionToken).toBe(token);
    const report = structuredClone(exampleReport);
    report.routes[0]!.scenarios[0]!.findings[0]!.sourceTimeline = result();
    expect(auditReportSchema.safeParse(report).success).toBe(true);
    expect(() => validatePublicReport(report)).toThrow(
      'inspection capabilities',
    );
    report.routes[0]!.scenarios[0]!.findings[0]!.sourceTimeline = copy;
    expect(validatePublicReport(report)).toEqual(report);
  });
  it('provides measured repair clues and static escaped output without claiming causal proof', () => {
    const value = result();
    const clue = sourceRepairClues(value.candidates[0]!).join(' ');
    expect(clue).toContain('keyframes');
    expect(clue).toContain('3.00–4.00 s');
    const finding = structuredClone(
      exampleReport.routes[0]!.scenarios[0]!.findings[0]!,
    );
    finding.sourceTimeline = value;
    value.candidates[0]!.selectorPath = ['<script>private()</script>'];
    const html = renderFindingDiagnostics(finding);
    expect(html).toContain('geen bewezen oorzaak');
    expect(html).toContain('is onbekend');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<(script|video|img|animate)[\s>]/);
    expect(html).not.toContain(value.candidates[0]!.inspectionToken!);
  });
  it('joins only validated timeline records to matching findings', () => {
    const finding = structuredClone(
      exampleReport.routes[0]!.scenarios[0]!.findings[0]!,
    );
    attachSourceTimelines([finding], { [finding.id]: result() });
    expect(finding.sourceTimeline).toBeDefined();
    delete finding.sourceTimeline;
    const invalid = result();
    invalid.windowEndEpochMs = 0;
    attachSourceTimelines([finding], { [finding.id]: invalid });
    expect(finding.sourceTimeline).toBeUndefined();
  });
});
