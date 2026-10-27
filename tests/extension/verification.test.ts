import {
  phasePlanFromEvidence,
  type PhaseEvidence,
} from '../../apps/chrome-extension/src/animation-phase';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LIMITS,
  type ScanJob,
  type ReplayScenario,
} from '../../apps/chrome-extension/src/model';
import {
  appendReview,
  buildVerificationPlan,
  compareVerification,
  replayStateKey,
  reviewSummary,
} from '../../apps/chrome-extension/src/verification';
import { historySummary } from '../../apps/chrome-extension/src/history';
import { mediaPlanFromEvidence } from '../../apps/chrome-extension/src/media-replay';

const anchor = {
  taskId: 'route',
  observationId: 'observation',
  findingId: 'finding',
};
function baseline(): ScanJob {
  const plan: ReplayScenario = {
    version: 1,
    route: 'https://example.test/guide',
    profile: 'current',
    viewport: { width: 1200, height: 800, dpr: 1 },
    steps: [
      { kind: 'scroll', y: 100 },
      {
        kind: 'control',
        target: {
          kind: 'accordion',
          selectorPath: [
            'html:nth-child(1) > body:nth-child(2) > button:nth-child(1)',
          ],
        },
        expectedState: 'expanded',
      },
    ],
    measuredStep: 1,
    durationMs: 2000,
    stateKey: '',
  };
  const phaseEvidence: PhaseEvidence = {
    version: 1,
    complete: true,
    reasons: [],
    start: { documentMs: 1000, timelineMs: 1000, epochMs: 100000 },
    end: { documentMs: 3000, timelineMs: 3000, epochMs: 102000 },
    animations: [],
  };
  plan.phasePlan = phasePlanFromEvidence(phaseEvidence);
  plan.stateKey = replayStateKey(plan);
  return {
    id: 'baseline',
    tabId: 1,
    origin: 'https://example.test',
    startUrl: plan.route,
    engineVersion: 'test-engine',
    runnerVersion: 'test-runner',
    scannerBuildSha256: 'a'.repeat(64),
    mode: 'AUTONOMOUS',
    startedAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:10Z',
    endedAt: '2026-01-01T10:00:10Z',
    state: 'COMPLETED',
    stopIntent: false,
    generation: 'lease',
    elapsedMs: 10000,
    skippedLinks: 0,
    limitations: [],
    limits: { ...DEFAULT_LIMITS },
    tasks: [
      {
        id: 'route',
        url: plan.route,
        depth: 0,
        state: 'OBSERVED',
        reasons: [],
        viewport: plan.viewport,
        observations: [
          {
            id: 'observation',
            scenario: 'accordion',
            achieved: true,
            coverage: 'TESTED',
            startedAt: '2026-01-01T10:00:00Z',
            endedAt: '2026-01-01T10:00:02Z',
            replay: plan,
            phaseEvidence,
            measurement: {
              status: 'NEEDS_REVIEW',
              passed: null,
              limitations: [],
              quality: {
                frameCount: 120,
                effectiveFps: 60,
                maxGapMs: 17,
                width: 1200,
                height: 800,
                downsampled: false,
                interrupted: false,
                captureWindowMs: 2000,
                leadingIdleMs: 10,
                trailingIdleMs: 10,
              },
              findings: [
                {
                  id: 'finding',
                  type: 'GENERAL_FLASH',
                  severity: 'warning',
                  reviewStatus: 'NEEDS_REVIEW',
                  startMs: 100,
                  endMs: 1000,
                  flashesInWindow: 3.5,
                  qualifyingTransitions: 7,
                  affectedRatio: 0.01,
                  region: { x: 100, y: 100, width: 20, height: 20 },
                  message: 'Candidate',
                  sourceTimeline: {
                    version: 1,
                    status: 'UNAVAILABLE',
                    reason: 'Synthetic verification fixture clock',
                    frameClock: {
                      method: 'PER_FRAME_RECEIPT',
                      matchedFrames: 48,
                      receiptOffsetSpreadMs: 0,
                      startBoundaryErrorMs: 1,
                      endBoundaryErrorMs: 1,
                    },
                    clockBasis: 'FRAME_RECEIPT_ESTIMATE',
                    windowStartEpochMs: 100200,
                    windowEndEpochMs: 101000,
                    alignmentUncertaintyMs: null,
                    sampledAt: '2026-01-01T10:00:00Z',
                    sampleIntervalMs: 33,
                    maxSampleGapMs: 33,
                    sampleCount: 0,
                    complete: false,
                    candidates: [],
                    limitations: [],
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
function repeated(base: ScanJob, found = false): ScanJob {
  const job = structuredClone(base);
  job.id = 'verification';
  job.startedAt = '2026-01-01T11:00:00Z';
  job.endedAt = job.updatedAt = '2026-01-01T11:00:10Z';
  job.verificationOf = {
    jobId: base.id,
    taskId: anchor.taskId,
    observationId: anchor.observationId,
  };
  job.replayTarget = structuredClone(base.tasks[0].observations[0].replay!);
  const result = job.tasks[0].observations[0].measurement!;
  result.status = found ? 'NEEDS_REVIEW' : 'NO_ISSUES_OBSERVED';
  if (!found) result.findings = [];
  delete job.reviews;
  return job;
}
afterEach(() => vi.useRealTimers());

describe('targeted verification and explicit local review', () => {
  it('reproduces the actual measured action and returns an isolated plan', () => {
    const job = baseline();
    const plan = buildVerificationPlan(job, 'route', 'observation');
    expect(plan.measuredStep).toBe(1);
    plan.steps.length = 0;
    expect(job.tasks[0].observations[0].replay!.steps).toHaveLength(2);
  });
  it('preserves legacy physical replay identity and distinguishes CDP-responsive geometry', () => {
    const base = baseline(),
      plan = base.tasks[0].observations[0].replay!;
    const legacyKey = plan.stateKey;
    plan.viewportMethod = 'PHYSICAL';
    expect(replayStateKey(plan)).toBe(legacyKey);
    expect(
      buildVerificationPlan(base, 'route', 'observation').viewportMethod,
    ).toBe('PHYSICAL');
    plan.viewportMethod = 'CDP';
    plan.stateKey = replayStateKey(plan);
    expect(plan.stateKey).not.toBe(legacyKey);
    expect(
      buildVerificationPlan(base, 'route', 'observation').viewportMethod,
    ).toBe('CDP');
    const next = repeated(base);
    const repeatedPlan = next.tasks[0].observations[0].replay!;
    repeatedPlan.viewportMethod = 'PHYSICAL';
    repeatedPlan.stateKey = replayStateKey(repeatedPlan);
    expect(compareVerification(base, anchor, next).status).toBe('INCOMPARABLE');
  });
  it('refuses unachieved, expired, changed or out-of-scope recipes', () => {
    for (const corrupt of [
      (job: ScanJob) => {
        job.tasks[0].observations[0].achieved = false;
      },
      (job: ScanJob) => {
        job.detailsExpiredAt = '2026-02-01T00:00:00Z';
      },
      (job: ScanJob) => {
        job.tasks[0].observations[0].replay!.route = 'https://evil.test/';
      },
      (job: ScanJob) => {
        job.tasks[0].observations[0].replay!.steps[0] = {
          kind: 'scroll',
          y: 500,
        };
      },
      (job: ScanJob) => {
        job.tasks[0].observations[0].replay!.measuredStep = 0;
      },
    ]) {
      const job = baseline();
      corrupt(job);
      expect(() =>
        buildVerificationPlan(job, 'route', 'observation'),
      ).toThrow();
    }
  });
  it('does not automatically resolve an absent candidate', () => {
    const base = baseline(),
      next = repeated(base);
    expect(compareVerification(base, anchor, next).status).toBe('NOT_OBSERVED');
    expect(historySummary([base, next])[0].resolvedIssues).toBe(0);
    expect(() =>
      appendReview(
        base,
        {
          ...anchor,
          decision: 'RESOLVED',
          note: 'Changed effect',
          verificationJobId: next.id,
        },
        next,
      ),
    ).toThrow(/Bevestig eerst/);
  });
  it.each([
    'version',
    'build',
    'unknown-build',
    'viewport',
    'plan',
    'sampling',
    'gap',
    'downsample',
    'interruption',
    'duration',
    'coverage',
    'expiry',
    'target',
  ])('rejects a clean result when %s is not comparable', (change) => {
    const base = baseline(),
      next = repeated(base),
      observation = next.tasks[0].observations[0];
    const quality = observation.measurement!.quality;
    if (change === 'version') next.engineVersion = 'changed-engine';
    if (change === 'build') next.scannerBuildSha256 = 'b'.repeat(64);
    if (change === 'unknown-build') {
      delete base.scannerBuildSha256;
      delete next.scannerBuildSha256;
    }
    if (change === 'viewport') {
      observation.replay!.viewport.width = 1000;
      observation.replay!.stateKey = replayStateKey(observation.replay!);
    }
    if (change === 'plan') {
      observation.replay!.steps = [];
      observation.replay!.stateKey = replayStateKey(observation.replay!);
    }
    if (change === 'sampling') quality.effectiveFps = 20;
    if (change === 'gap') quality.maxGapMs = 150;
    if (change === 'downsample') quality.downsampled = true;
    if (change === 'interruption') quality.interrupted = true;
    if (change === 'duration') quality.captureWindowMs = 1000;
    if (change === 'coverage') observation.coverage = 'UNREACHED';
    if (change === 'expiry') next.detailsExpiredAt = '2026-02-01T00:00:00Z';
    if (change === 'target') delete next.verificationOf;
    expect(compareVerification(base, anchor, next).status).toBe('INCOMPARABLE');
  });
  it('refuses resolution if the original measurement was inadequate', () => {
    const base = baseline(),
      next = repeated(base);
    base.tasks[0].observations[0].measurement!.status = 'INCONCLUSIVE';
    expect(compareVerification(base, anchor, next).status).toBe('INCOMPARABLE');
  });
  it('requires explicit confirmation and clean comparable evidence to close, preserving the review trail', () => {
    const base = baseline(),
      next = repeated(base);
    appendReview(base, {
      ...anchor,
      decision: 'CONFIRMED',
      note: 'Verified CSS effect locally',
    });
    appendReview(
      base,
      {
        ...anchor,
        decision: 'RESOLVED',
        note: 'Removed alternating colour keyframes',
        verificationJobId: next.id,
      },
      next,
    );
    expect(base.reviews).toHaveLength(2);
    expect(reviewSummary([base, next])).toEqual({
      confirmed: 0,
      resolved: 1,
      reopened: 0,
      falsePositives: 0,
    });
    expect(historySummary([base, next])[0].confirmedViolations).toBe(0);
  });
  it('requires a new comparable recurrence after resolution, then records explicit reopening', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    const base = baseline(),
      next = repeated(base);
    appendReview(base, {
      ...anchor,
      decision: 'CONFIRMED',
      note: 'Confirmed effect',
    });
    appendReview(
      base,
      {
        ...anchor,
        decision: 'RESOLVED',
        note: 'Effect removed',
        verificationJobId: next.id,
      },
      next,
    );
    const recurrence = repeated(base, true);
    recurrence.id = 'recurrence';
    expect(() =>
      appendReview(
        base,
        {
          ...anchor,
          decision: 'REOPENED',
          note: 'Reproduced effect',
          verificationJobId: recurrence.id,
        },
        recurrence,
      ),
    ).toThrow(/nieuwe/);
    recurrence.startedAt = '2026-01-02T12:00:00Z';
    recurrence.endedAt = '2026-01-02T12:00:10Z';
    vi.setSystemTime(new Date('2026-01-02T12:01:00Z'));
    appendReview(
      base,
      {
        ...anchor,
        decision: 'REOPENED',
        note: 'Reproduced after theme update',
        verificationJobId: recurrence.id,
      },
      recurrence,
    );
    expect(reviewSummary([base, next, recurrence])).toEqual({
      confirmed: 1,
      resolved: 0,
      reopened: 1,
      falsePositives: 0,
    });
    const resolve = (check: ScanJob) =>
      appendReview(
        base,
        {
          ...anchor,
          decision: 'RESOLVED',
          note: 'Reviewed repair',
          verificationJobId: check.id,
        },
        check,
      );
    expect(() => resolve(next)).toThrow(/nieuwe hercontrole/);
    // Reconfirming cannot erase the previous recurrence and recycle old evidence.
    appendReview(base, {
      ...anchor,
      decision: 'CONFIRMED',
      note: 'Still needs repair',
    });
    expect(() => resolve(next)).toThrow(/nieuwe hercontrole/);
    const fresh = repeated(base);
    fresh.id = 'new-repair';
    fresh.startedAt = '2026-01-03T12:00:00Z';
    fresh.endedAt = '2026-01-03T12:00:10Z';
    vi.setSystemTime(new Date('2026-01-03T12:01:00Z'));
    expect(() => resolve(fresh)).not.toThrow();
    expect(reviewSummary([base]).resolved).toBe(1);
  });
  it('will not treat a different nearby signal as proof the original issue disappeared', () => {
    const base = baseline(),
      next = repeated(base, true);
    next.tasks[0].observations[0].measurement!.findings[0].region!.x = 700;
    expect(compareVerification(base, anchor, next).status).toBe('INCOMPARABLE');
  });
});

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
