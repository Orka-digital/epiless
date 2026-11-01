import {
  phasePlanFromEvidence,
  type PhaseEvidence,
} from '../../apps/chrome-extension/src/animation-phase';

import { afterEach, vi } from 'vitest';

import {
  DEFAULT_LIMITS,
  type ReplayScenario,
  type ScanJob,
} from '../../apps/chrome-extension/src/model';

import { replayStateKey } from '../../apps/chrome-extension/src/verification';

export const anchor = {
  taskId: 'route',
  observationId: 'observation',
  findingId: 'finding',
};

export function baseline(): ScanJob {
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

export function repeated(base: ScanJob, found = false): ScanJob {
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
