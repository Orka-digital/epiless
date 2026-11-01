import type { Finding } from '@epi-less/core';

import { samePath } from './animation-phase-path';
import {
  EPSILON_MS,
  type AnimationPhaseRecord,
  type PhaseEvidence,
} from './animation-phase-types';
import {
  validPhaseEvidence,
  validPhasePlan,
} from './animation-phase-validation';
import type { Observation } from './model';

/** Explain missing phase coverage; matching timing is correlation, never proof of causality. */
export function phaseComparisonReasons(
  baseline: Observation,
  repeated: Observation,
  finding?: Finding,
): string[] {
  const before = baseline.phaseEvidence,
    after = repeated.phaseEvidence,
    plan = baseline.replay?.phasePlan;
  if (
    !before ||
    !after ||
    !plan ||
    !validPhaseEvidence(before) ||
    !validPhaseEvidence(after) ||
    !validPhasePlan(plan)
  )
    return ['PHASE_EVIDENCE_UNAVAILABLE'];
  if (!before.complete || !after.complete || plan.status !== 'REPLAYABLE')
    return [
      'PHASE_EVIDENCE_INCOMPLETE',
      ...new Set([...before.reasons, ...after.reasons, ...plan.reasons]),
    ];
  const candidateReasons = candidatePhaseReasons(finding, before);
  if (candidateReasons.length) return candidateReasons;
  // A nearby action and an exact sampled target establish temporal correlation,
  // not that the action caused the animation. A fixed document timer can start
  // at the same moment. Therefore TRIGGER never waives document coverage.
  if (
    after.start.documentMs > before.start.documentMs + EPSILON_MS ||
    after.end.documentMs < before.end.documentMs - EPSILON_MS
  )
    return ['DOCUMENT_PHASE_INTERVAL_NOT_COVERED'];
  if (
    plan.mode === 'TRIGGER' &&
    (!before.trigger?.after ||
      !after.trigger?.after ||
      after.end.documentMs - after.trigger.before.documentMs <
        before.end.documentMs - before.trigger.before.documentMs - EPSILON_MS)
  )
    return ['TRIGGER_PHASE_INTERVAL_NOT_COVERED'];
  return compareAnimations(plan, before, after);
}

function compareAnimations(
  plan: import('./animation-phase-types').PhaseReplayPlan,
  before: PhaseEvidence,
  after: PhaseEvidence,
): string[] {
  for (const original of plan.animations) {
    const matches = after.animations.filter(
      (r) =>
        samePath(r.selectorPath, original.selectorPath) &&
        r.kind === original.kind &&
        r.ordinal === original.ordinal,
    );
    // Removing the effect is a legitimate fix when complete discovery and the
    // original document/action interval were observed. No keyframe content hash.
    if (!matches.length) continue;
    if (matches.length !== 1) return ['ANIMATION_PHASE_IDENTITY_AMBIGUOUS'];
    const current = matches[0];
    if (plan.mode === 'TRIGGER' && current.origin !== 'TRIGGER')
      return ['ANIMATION_TRIGGER_NOT_REPRODUCED'];
    if (
      current.first.playbackRate !== original.first.playbackRate ||
      current.first.durationMs !== original.first.durationMs ||
      current.first.delayMs !== original.first.delayMs ||
      current.first.iterations !== original.first.iterations
    )
      return ['ANIMATION_TIMING_CHANGED'];
    const startAt = (record: AnimationPhaseRecord, evidence: PhaseEvidence) =>
      Math.max(
        0,
        (evidence.start.timelineMs - record.first.startTimeMs) *
          record.first.playbackRate,
      );
    if (
      startAt(current, after) > startAt(original, before) + EPSILON_MS ||
      current.last.currentTimeMs < original.last.currentTimeMs - EPSILON_MS
    )
      return ['ANIMATION_PHASE_INTERVAL_NOT_COVERED'];
  }
  return [];
}

function candidatePhaseReasons(
  finding: Finding | undefined,
  before: PhaseEvidence,
): string[] {
  if (finding && !finding.sourceTimeline?.frameClock)
    return ['CANDIDATE_PHASE_BOUNDARY_UNPROVEN'];
  if (
    finding?.sourceTimeline &&
    (finding.sourceTimeline.windowStartEpochMs -
      (finding.sourceTimeline.frameClock?.startBoundaryErrorMs ?? 0) <
      before.start.epochMs ||
      finding.sourceTimeline.windowEndEpochMs +
        (finding.sourceTimeline.frameClock?.endBoundaryErrorMs ?? 0) >
        before.end.epochMs)
  )
    return ['CANDIDATE_OUTSIDE_PHASE_OBSERVATION'];
  return [];
}
