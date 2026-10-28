import { describe, expect, it } from 'vitest';

import { type ScanJob } from '../../apps/chrome-extension/src/model';

import {
  appendReview,
  buildVerificationPlan,
  compareVerification,
  replayStateKey,
  reviewSummary,
} from '../../apps/chrome-extension/src/verification';

import { historySummary } from '../../apps/chrome-extension/src/history';

import { anchor, baseline, repeated } from './verification.fixture';
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
});
