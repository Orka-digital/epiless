import type { Finding } from '@epi-less/core';
import type { Observation } from './model';

export const PHASE_ANIMATION_LIMIT = 32;
export const PHASE_WAIT_LIMIT_MS = 30_000;
export const PHASE_ALIGNMENT_LEAD_MS = 150;
/** Numeric clock rounding only; never substitutes for an unobserved interval. */
const EPSILON_MS = 2;
export interface PhaseClock {
  documentMs: number;
  timelineMs: number;
  epochMs: number;
}
export interface AnimationPhaseState {
  clock: PhaseClock;
  currentTimeMs: number;
  startTimeMs: number;
  playbackRate: number;
  playState: 'running' | 'finished' | 'paused' | 'idle';
  durationMs: number;
  delayMs: number;
  iterations: number | null;
}
export interface AnimationPhaseRecord {
  selectorPath: string[];
  kind: 'CSS_ANIMATION' | 'CSS_TRANSITION' | 'WEB_ANIMATION';
  ordinal: number;
  origin: 'DOCUMENT' | 'TRIGGER';
  first: AnimationPhaseState;
  last: AnimationPhaseState;
}
export interface PhaseEvidence {
  version: 1;
  complete: boolean;
  reasons: string[];
  start: PhaseClock;
  end: PhaseClock;
  trigger?: { before: PhaseClock; after?: PhaseClock };
  animations: AnimationPhaseRecord[];
}
export interface PhaseReplayPlan {
  version: 1;
  status: 'REPLAYABLE' | 'UNSUPPORTED';
  reasons: string[];
  mode: 'DOCUMENT' | 'TRIGGER';
  startDocumentMs: number;
  endDocumentMs: number;
  triggerDurationMs?: number;
  animations: AnimationPhaseRecord[];
}
const finite = (v: unknown, max = 86_400_000): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const signed = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 86_400_000;
const reasons = (v: unknown): v is string[] =>
  Array.isArray(v) &&
  v.length <= 32 &&
  v.every((x) => typeof x === 'string' && x.length <= 200);
export const validPhaseClock = (v: unknown): v is PhaseClock => {
  const c = v as PhaseClock;
  return Boolean(
    c &&
    finite(c.documentMs) &&
    finite(c.timelineMs) &&
    finite(c.epochMs, 10_000_000_000_000),
  );
};
function validState(s: AnimationPhaseState) {
  return (
    s &&
    validPhaseClock(s.clock) &&
    signed(s.currentTimeMs) &&
    signed(s.startTimeMs) &&
    finite(s.playbackRate, 16) &&
    s.playbackRate > 0 &&
    ['running', 'finished', 'paused', 'idle'].includes(s.playState) &&
    finite(s.durationMs) &&
    signed(s.delayMs) &&
    (s.iterations === null || finite(s.iterations, 1_000_000))
  );
}
function validRecords(v: unknown): v is AnimationPhaseRecord[] {
  return (
    Array.isArray(v) &&
    v.length <= PHASE_ANIMATION_LIMIT &&
    v.every(
      (r) =>
        r &&
        Array.isArray(r.selectorPath) &&
        r.selectorPath.length > 0 &&
        r.selectorPath.length <= 8 &&
        r.selectorPath.every(
          (p: unknown) =>
            typeof p === 'string' && p.length > 0 && p.length <= 512,
        ) &&
        ['CSS_ANIMATION', 'CSS_TRANSITION', 'WEB_ANIMATION'].includes(r.kind) &&
        Number.isInteger(r.ordinal) &&
        r.ordinal >= 0 &&
        r.ordinal < PHASE_ANIMATION_LIMIT &&
        ['DOCUMENT', 'TRIGGER'].includes(r.origin) &&
        validState(r.first) &&
        validState(r.last) &&
        r.last.clock.documentMs >= r.first.clock.documentMs,
    )
  );
}
export function validPhaseEvidence(v: unknown): v is PhaseEvidence {
  const e = v as PhaseEvidence;
  return Boolean(
    e &&
    e.version === 1 &&
    typeof e.complete === 'boolean' &&
    reasons(e.reasons) &&
    validPhaseClock(e.start) &&
    validPhaseClock(e.end) &&
    e.end.documentMs >= e.start.documentMs &&
    e.end.documentMs - e.start.documentMs <= 125_000 &&
    validRecords(e.animations) &&
    Math.abs(
      e.end.epochMs - e.start.epochMs - (e.end.documentMs - e.start.documentMs),
    ) <= 2 &&
    e.animations.every(
      (r) =>
        r.first.clock.documentMs >= e.start.documentMs &&
        r.last.clock.documentMs <= e.end.documentMs &&
        r.first.clock.epochMs >= e.start.epochMs &&
        r.last.clock.epochMs <= e.end.epochMs,
    ) &&
    (!e.complete || e.reasons.length === 0) &&
    (!e.trigger ||
      (validPhaseClock(e.trigger.before) &&
        e.trigger.before.documentMs >= e.start.documentMs &&
        (!e.trigger.after ||
          (validPhaseClock(e.trigger.after) &&
            e.trigger.after.documentMs >= e.trigger.before.documentMs &&
            e.trigger.after.documentMs <= e.end.documentMs)))),
  );
}
export function copyPhaseEvidence(v: unknown): PhaseEvidence | undefined {
  if (!validPhaseEvidence(v)) return undefined;
  // Content replies are not trusted object spreads. Retain the finite allowlist.
  const clock = (c: PhaseClock): PhaseClock => ({
    documentMs: c.documentMs,
    timelineMs: c.timelineMs,
    epochMs: c.epochMs,
  });
  const state = (s: AnimationPhaseState): AnimationPhaseState => ({
    clock: clock(s.clock),
    currentTimeMs: s.currentTimeMs,
    startTimeMs: s.startTimeMs,
    playbackRate: s.playbackRate,
    playState: s.playState,
    durationMs: s.durationMs,
    delayMs: s.delayMs,
    iterations: s.iterations,
  });
  return {
    version: 1,
    complete: v.complete,
    reasons: [...v.reasons],
    start: clock(v.start),
    end: clock(v.end),
    ...(v.trigger
      ? {
          trigger: {
            before: clock(v.trigger.before),
            ...(v.trigger.after ? { after: clock(v.trigger.after) } : {}),
          },
        }
      : {}),
    animations: v.animations.map((r) => ({
      selectorPath: [...r.selectorPath],
      kind: r.kind,
      ordinal: r.ordinal,
      origin: r.origin,
      first: state(r.first),
      last: state(r.last),
    })),
  };
}
export function validPhasePlan(v: unknown): v is PhaseReplayPlan {
  const p = v as PhaseReplayPlan;
  return Boolean(
    p &&
    p.version === 1 &&
    ['REPLAYABLE', 'UNSUPPORTED'].includes(p.status) &&
    reasons(p.reasons) &&
    ['DOCUMENT', 'TRIGGER'].includes(p.mode) &&
    finite(p.startDocumentMs) &&
    finite(p.endDocumentMs) &&
    p.endDocumentMs >= p.startDocumentMs &&
    p.endDocumentMs - p.startDocumentMs <= 125_000 &&
    validRecords(p.animations) &&
    (p.triggerDurationMs === undefined ||
      finite(p.triggerDurationMs, 125_000)) &&
    (p.mode !== 'TRIGGER' || p.triggerDurationMs !== undefined) &&
    (p.status !== 'REPLAYABLE' || p.reasons.length === 0),
  );
}
const samePath = (a: readonly string[], b: readonly string[]) =>
  JSON.stringify(a) === JSON.stringify(b);
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
