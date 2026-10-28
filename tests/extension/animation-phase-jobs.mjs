import assert from 'node:assert/strict';
/** Build explicitly synthetic findings around measured browser animation evidence. */
export function createPhaseJobs(
  url,
  { compareVerification, replayStateKey, phasePlanFromEvidence },
) {
  function jobs(original, repeated, triggered = false) {
    const bright = original.colors.filter(
      (x) => x.color === 'rgb(125, 125, 125)',
    );
    assert.ok(bright.length >= 3);
    const path = original.evidence.animations[0]?.selectorPath;
    assert.ok(path);
    const finding = {
      id: 'finding',
      type: 'GENERAL_FLASH',
      severity: 'warning',
      reviewStatus: 'NEEDS_REVIEW',
      region: { x: 8, y: 29, width: 2, height: 2 },
      sourceTimeline: {
        version: 1,
        status: 'CORRELATED',
        complete: true,
        clockBasis: 'FRAME_RECEIPT_ESTIMATE',
        windowStartEpochMs: bright[0].epochMs,
        windowEndEpochMs: bright.at(-1).epochMs,
        frameClock: {
          method: 'PER_FRAME_RECEIPT',
          startBoundaryErrorMs: 0,
          endBoundaryErrorMs: 0,
        },
        candidates: [{ selectorPath: path }],
      },
    };
    const phasePlan = phasePlanFromEvidence(
      original.evidence,
      [finding],
      triggered,
    );
    const plan = {
      version: 1,
      route: url,
      profile: 'current',
      viewport: { width: 1280, height: 720, dpr: 1 },
      steps: triggered
        ? [
            {
              kind: 'control',
              target: {
                kind: 'accordion',
                selectorPath: ['button:nth-child(1)'],
              },
            },
          ]
        : [],
      ...(triggered ? { measuredStep: 0 } : {}),
      durationMs: 1000,
      stateKey: '',
      phasePlan,
    };
    plan.stateKey = replayStateKey(plan);
    const job = (id, observed, positive) => ({
      id,
      state: 'COMPLETED',
      origin: new URL(url).origin,
      startUrl: url,
      engineVersion: 'browser-phase-fixture',
      runnerVersion: 'browser-phase-fixture',
      scannerBuildSha256: 'a'.repeat(64),
      startedAt:
        id === 'baseline' ? '2026-01-01T00:00:00Z' : '2026-01-01T01:00:00Z',
      endedAt:
        id === 'baseline' ? '2026-01-01T00:00:10Z' : '2026-01-01T01:00:10Z',
      tasks: [
        {
          id: 'route',
          url,
          observations: [
            {
              id: 'observation',
              scenario: 'phase-fixture',
              achieved: true,
              coverage: 'TESTED',
              replay: structuredClone(plan),
              phaseEvidence: observed.evidence,
              measurement: {
                status: positive ? 'NEEDS_REVIEW' : 'NO_ISSUES_OBSERVED',
                findings: positive ? [finding] : [],
                limitations: [],
                quality: {
                  frameCount: 120,
                  effectiveFps: 60,
                  maxGapMs: 17,
                  width: 1280,
                  height: 720,
                  downsampled: false,
                  interrupted: false,
                  captureWindowMs: 2000,
                  leadingIdleMs: 0,
                  trailingIdleMs: 0,
                },
              },
            },
          ],
        },
      ],
    });
    const base = job('baseline', original, true),
      next = job(
        'repeated',
        repeated,
        repeated.colors.some((x) => x.color === 'rgb(125, 125, 125)'),
      );
    next.verificationOf = {
      jobId: base.id,
      taskId: 'route',
      observationId: 'observation',
    };
    return {
      comparison: compareVerification(
        base,
        { taskId: 'route', observationId: 'observation', findingId: 'finding' },
        next,
      ),
      phasePlan,
    };
  }
  return jobs;
}
