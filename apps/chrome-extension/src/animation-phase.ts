import type { Finding } from '@epi-less/core';

import {
  type AnimationPhaseRecord,
  type PhaseEvidence,
  type PhaseReplayPlan,
} from './animation-phase-types';

import { samePath } from './animation-phase-path';
import { validPhaseEvidence } from './animation-phase-validation';

/** Exact sampled target permits extra action-relative evidence, never causal attribution. */
function allFindingsHaveTriggeredTarget(
  findings: readonly Finding[],
  records: readonly AnimationPhaseRecord[],
  triggerEpochMs: number,
) {
  return (
    findings.length > 0 &&
    findings.every((f) => {
      const timeline = f.sourceTimeline;
      if (
        !timeline?.complete ||
        timeline.status !== 'CORRELATED' ||
        timeline.windowStartEpochMs < triggerEpochMs
      )
        return false;
      const candidates = timeline.candidates;
      return (
        candidates.length === 1 &&
        records.some(
          (r) =>
            r.origin === 'TRIGGER' &&
            samePath(r.selectorPath, candidates[0].selectorPath),
        )
      );
    })
  );
}

/** Derive replay prerequisites from complete observed phase evidence; unsupported evidence remains explicit. */
export function phasePlanFromEvidence(
  e: PhaseEvidence | undefined,
  findings: readonly Finding[] = [],
  hasMeasuredTrigger = false,
): PhaseReplayPlan {
  if (!e || !validPhaseEvidence(e))
    return {
      version: 1,
      status: 'UNSUPPORTED',
      reasons: ['PHASE_EVIDENCE_UNAVAILABLE'],
      mode: 'DOCUMENT',
      startDocumentMs: 0,
      endDocumentMs: 0,
      animations: [],
    };
  const triggered =
    hasMeasuredTrigger &&
    Boolean(e.trigger?.after) &&
    e.animations.length > 0 &&
    e.animations.every((r) => r.origin === 'TRIGGER') &&
    allFindingsHaveTriggeredTarget(
      findings,
      e.animations,
      e.trigger!.before.epochMs,
    );
  return {
    version: 1,
    status: e.complete ? 'REPLAYABLE' : 'UNSUPPORTED',
    reasons: [...e.reasons],
    mode: triggered ? 'TRIGGER' : 'DOCUMENT',
    startDocumentMs: e.start.documentMs,
    endDocumentMs: e.end.documentMs,
    ...(triggered
      ? { triggerDurationMs: e.end.documentMs - e.trigger!.before.documentMs }
      : {}),
    animations: structuredClone(e.animations),
  };
}

/** Serialize phase prerequisites in stable field order for replay identity. */
export function phasePlanKey(plan: PhaseReplayPlan): unknown[] {
  return [
    plan.version,
    plan.status,
    plan.reasons,
    plan.mode,
    plan.startDocumentMs,
    plan.endDocumentMs,
    plan.triggerDurationMs ?? null,
    plan.animations.map((r) => [
      r.selectorPath,
      r.kind,
      r.ordinal,
      r.origin,
      r.first.currentTimeMs,
      r.last.currentTimeMs,
      r.first.startTimeMs,
      r.first.playbackRate,
      r.first.durationMs,
      r.first.delayMs,
      r.first.iterations,
    ]),
  ];
}

export { phaseComparisonReasons } from './animation-phase-comparison';

export {
  PHASE_ALIGNMENT_LEAD_MS,
  PHASE_ANIMATION_LIMIT,
  PHASE_WAIT_LIMIT_MS,
} from './animation-phase-types';

export type {
  AnimationPhaseRecord,
  AnimationPhaseState,
  PhaseClock,
  PhaseEvidence,
  PhaseReplayPlan,
} from './animation-phase-types';

export {
  copyPhaseEvidence,
  validPhaseClock,
  validPhaseEvidence,
  validPhasePlan,
} from './animation-phase-validation';
