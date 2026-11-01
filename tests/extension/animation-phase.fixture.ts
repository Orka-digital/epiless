import {
  phasePlanFromEvidence,
  type AnimationPhaseRecord,
  type PhaseEvidence,
} from '../../apps/chrome-extension/src/animation-phase';

import type { Observation } from '../../apps/chrome-extension/src/model';

import type { Finding } from '@epi-less/core';

export const clock = (time: number) => ({
  documentMs: time,
  timelineMs: time,
  epochMs: 100_000 + time,
});

export const animation = (
  origin: AnimationPhaseRecord['origin'] = 'DOCUMENT',
): AnimationPhaseRecord => ({
  selectorPath: ['div:nth-child(1)'],
  kind: 'CSS_ANIMATION',
  ordinal: 0,
  origin,
  first: {
    clock: clock(1000),
    currentTimeMs: 1000,
    startTimeMs: 0,
    playbackRate: 1,
    playState: 'running',
    durationMs: 10000,
    delayMs: 0,
    iterations: 1,
  },
  last: {
    clock: clock(3000),
    currentTimeMs: 3000,
    startTimeMs: 0,
    playbackRate: 1,
    playState: 'running',
    durationMs: 10000,
    delayMs: 0,
    iterations: 1,
  },
});

export const evidence = (): PhaseEvidence => ({
  version: 1,
  complete: true,
  reasons: [],
  start: clock(1000),
  end: clock(3000),
  animations: [animation()],
});

export const observation = (e: PhaseEvidence) =>
  ({
    phaseEvidence: e,
    replay: { phasePlan: phasePlanFromEvidence(e) },
  }) as Observation;

export const finding = (): Finding =>
  ({
    sourceTimeline: {
      status: 'CORRELATED',
      complete: true,
      windowStartEpochMs: 101200,
      windowEndEpochMs: 102000,
      frameClock: { startBoundaryErrorMs: 1, endBoundaryErrorMs: 1 },
      candidates: [{ selectorPath: ['div:nth-child(1)'] }],
    },
  }) as Finding;
