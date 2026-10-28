import {
  type AnimationPhaseRecord,
  type AnimationPhaseState,
  PHASE_ANIMATION_LIMIT,
  type PhaseClock,
  type PhaseEvidence,
  type PhaseReplayPlan,
} from './animation-phase-types';

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

/** Check bounded phase records and clock ordering without trusting stored data. */
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

/** Copy only validated phase fields; invalid input yields no evidence. */
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

/** Validate replay phase bounds before any browser action. */
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
