import { describe, expect, it } from 'vitest';

import { type ScanJob } from '../../apps/chrome-extension/src/model';

import {
  buildVerificationPlan,
  compareVerification,
  replayStateKey,
} from '../../apps/chrome-extension/src/verification';

import { mediaPlanFromEvidence } from '../../apps/chrome-extension/src/media-replay';
import { anchor, baseline, repeated } from './verification.fixture';
describe('media-backed negative rechecks and resolution', () => {
  function withMedia(): ScanJob {
    const job = baseline(),
      observation = job.tasks[0].observations[0];
    const before = {
      selectorPath: ['video:nth-child(1)'],
      sourceKind: 'URL' as const,
      locatorSha256: 'a'.repeat(64),
      durationMs: 10_000,
      timeMs: 1000,
      playbackRate: 1,
      loop: false,
      paused: true,
      seekable: [[0, 10_000]] as [number, number][],
    };
    observation.mediaEvidence = {
      version: 1,
      complete: true,
      reasons: [],
      startedEpochMs: 100_000,
      endedEpochMs: 102_000,
      items: [
        {
          before,
          after: { ...before, timeMs: 3000 },
          samples: Array.from({ length: 41 }, (_, index) => ({
            atMs: index * 50,
            timeMs: 1000 + index * 50,
            paused: index === 0,
            ended: false,
            seeking: false,
            playbackRate: 1,
            loop: false,
            presentation: {
              timeMs: 1000 + index * 50,
              count: index + 1,
              wraps: 0,
            },
          })),
        },
      ],
    };
    observation.mediaEvidence.items[0].presentations =
      observation.mediaEvidence.items[0].samples.map((sample, index) => ({
        atMs: sample.atMs,
        timeMs: sample.timeMs,
        presentedFrames: index + 1,
      }));
    observation.replay!.mediaPlan = mediaPlanFromEvidence(
      observation.mediaEvidence,
    );
    observation.replay!.stateKey = replayStateKey(observation.replay!);
    observation.measurement!.findings[0].sourceTimeline = {
      version: 1,
      status: 'UNAVAILABLE',
      reason: 'fixture mapping is not used for this interval check',
      clockBasis: 'FRAME_RECEIPT_ESTIMATE',
      windowStartEpochMs: 100_200,
      windowEndEpochMs: 101_000,
      alignmentUncertaintyMs: null,
      frameClock: {
        method: 'PER_FRAME_RECEIPT',
        matchedFrames: 48,
        receiptOffsetSpreadMs: 0,
        startBoundaryErrorMs: 1,
        endBoundaryErrorMs: 1,
      },
      sampledAt: '2026-01-01T10:00:00Z',
      sampleIntervalMs: 33,
      maxSampleGapMs: 33,
      sampleCount: 0,
      complete: false,
      candidates: [],
      limitations: [],
    };
    return job;
  }

  it('accepts a same-build negative only after the same actual media interval', () => {
    const base = withMedia();
    expect(compareVerification(base, anchor, repeated(base)).status).toBe(
      'NOT_OBSERVED',
    );
    const next = repeated(base);
    next.tasks[0].observations[0].mediaEvidence!.items[0].samples.pop();
    expect(compareVerification(base, anchor, next).status).toBe('INCOMPARABLE');
  });

  it('cannot resolve a disclosure candidate from a different clip position or an unbound media clock', () => {
    const base = withMedia(),
      next = repeated(base);
    next.tasks[0].observations[0].mediaEvidence!.items[0].before.timeMs += 500;
    expect(compareVerification(base, anchor, next).status).toBe('INCOMPARABLE');
    delete base.tasks[0].observations[0].measurement!.findings[0]
      .sourceTimeline;
    expect(compareVerification(base, anchor, repeated(base)).status).toBe(
      'INCOMPARABLE',
    );
  });

  it('keeps source-locator and interval targets inside the validated recipe identity', () => {
    const base = withMedia();
    const plan = buildVerificationPlan(base, 'route', 'observation');
    plan.mediaPlan!.items[0].timeMs += 50;
    expect(replayStateKey(plan)).not.toBe(plan.stateKey);
    base.tasks[0].observations[0].replay!.mediaPlan!.coverage![0].endMs =
      Infinity;
    expect(() => buildVerificationPlan(base, 'route', 'observation')).toThrow(
      /mediavoorwaarden/,
    );
  });
});
