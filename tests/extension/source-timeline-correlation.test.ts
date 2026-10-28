import { describe, expect, it } from 'vitest';

import { sourceTimelineSchema } from '../../packages/core/src/source-timeline-schema';

import {
  copySourceTimeline,
  renderFindingDiagnostics,
  sourceRepairClues,
} from '../../packages/core/src/diagnostics';

import { exampleReport } from '../../apps/web/src/lib/example-report';

import {
  base,
  buffer,
  event,
  result,
  snapshot,
} from './source-timeline.fixture';
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
});
