import { structuralDiagnosticPath } from './source-diagnostics';

import {
  PHASE_ANIMATION_LIMIT,
  validPhaseClock,
  type AnimationPhaseRecord,
  type AnimationPhaseState,
  type PhaseClock,
  type PhaseEvidence,
} from './animation-phase';
import { readAnimationState } from './animation-phase-clock';

export interface AnimationPhaseSession {
  generation: string;
  segmentId: string;
  evidence: PhaseEvidence;
  roots: (Document | ShadowRoot)[];
  records: Map<Animation, AnimationPhaseRecord>;
  preTrigger: WeakSet<Animation>;
  unresolved: Set<Animation>;
  discoveryOverflow: boolean;
  frame: number;
  watchdog: ReturnType<typeof setTimeout>;
  lastSample: number;
}

/** Sample bounded animation membership and timing; mark clock gaps and discovery truncation in the active evidence. */
export function samplePhase(
  active: AnimationPhaseSession,
  clock: () => PhaseClock,
  reason: (value: string) => void,
) {
  const at = clock();
  if (!validPhaseClock(at)) {
    reason('DOCUMENT_PHASE_CLOCK_UNAVAILABLE');
    return;
  }
  if (at.documentMs - active.lastSample > 500)
    reason('ANIMATION_PHASE_SAMPLING_GAP');
  active.lastSample = at.documentMs;
  active.evidence.end = at;
  const discovered = new Set(active.records.keys());
  // getAnimations() itself returns a native array; do not multiply that
  // unavoidable first-root work across 65 roots or repeat it after overflow.
  if (!active.discoveryOverflow) {
    roots: for (const root of active.roots) {
      for (const animation of root.getAnimations()) {
        if (discovered.has(animation)) continue;
        if (discovered.size >= PHASE_ANIMATION_LIMIT) {
          active.discoveryOverflow = true;
          reason('ANIMATION_PHASE_LIMIT_REACHED');
          break roots;
        }
        discovered.add(animation);
      }
    }
  }
  const animations = [...discovered];
  const ordinals = new Map<string, number>();
  for (const animation of animations.slice(0, PHASE_ANIMATION_LIMIT)) {
    samplePhaseAnimation(active, animation, at, ordinals, reason);
  }
}

function samplePhaseAnimation(
  active: AnimationPhaseSession,
  animation: Animation,
  at: PhaseClock,
  ordinals: Map<string, number>,
  reason: (value: string) => void,
): void {
  if (!active.evidence.trigger) active.preTrigger.add(animation);
  const effect = animation.effect;
  if (
    !(effect instanceof KeyframeEffect) ||
    !(effect.target instanceof Element)
  ) {
    reason('ANIMATION_TARGET_UNAVAILABLE');
    return;
  }
  const selectorPath = structuralDiagnosticPath(effect.target);
  if (!selectorPath) {
    reason('ANIMATION_TARGET_UNAVAILABLE');
    return;
  }
  const kind = animationKind(animation);
  const key = JSON.stringify([selectorPath, kind]);
  const ordinal = ordinals.get(key) ?? 0;
  ordinals.set(key, ordinal + 1);
  const current = readAnimationState(animation, at, reason);
  const previous = active.records.get(animation);
  if (!current) {
    if (
      active.unresolved.size >= PHASE_ANIMATION_LIMIT &&
      !active.unresolved.has(animation)
    )
      reason('ANIMATION_PHASE_PENDING_LIMIT_REACHED');
    else active.unresolved.add(animation);
    if (previous && !animation.pending)
      reason('ANIMATION_PHASE_REMOVED_UNFINISHED');
    return;
  }
  active.unresolved.delete(animation);
  if (previous) {
    updatePhaseRecord(previous, current, reason);
  } else {
    if (active.records.size >= PHASE_ANIMATION_LIMIT) {
      reason('ANIMATION_PHASE_LIMIT_REACHED');
      return;
    }
    const trigger = active.evidence.trigger;
    const triggered =
      trigger &&
      !active.preTrigger.has(animation) &&
      current.startTimeMs >= trigger.before.timelineMs - 2 &&
      current.startTimeMs <= (trigger.after ?? at).timelineMs + 100 &&
      at.documentMs <= (trigger.after ?? at).documentMs + 150;
    const record: AnimationPhaseRecord = {
      selectorPath,
      kind,
      ordinal,
      origin: triggered ? 'TRIGGER' : 'DOCUMENT',
      first: current,
      last: current,
    };
    active.records.set(animation, record);
    active.evidence.animations.push(record);
  }
}

function updatePhaseRecord(
  previous: AnimationPhaseRecord,
  current: AnimationPhaseState,
  reason: (value: string) => void,
): void {
  if (
    previous.first.startTimeMs !== current.startTimeMs ||
    previous.first.playbackRate !== current.playbackRate ||
    previous.first.durationMs !== current.durationMs ||
    previous.first.delayMs !== current.delayMs ||
    previous.first.iterations !== current.iterations ||
    (previous.last.playState !== current.playState &&
      !['running', 'finished'].every((p) =>
        [previous.last.playState, current.playState].includes(
          p as AnimationPlayState,
        ),
      ))
  )
    reason('ANIMATION_PHASE_CHANGED_DURING_OBSERVATION');
  previous.last = current;
}

function animationKind(animation: Animation): AnimationPhaseRecord['kind'] {
  return typeof CSSAnimation !== 'undefined' &&
    animation instanceof CSSAnimation
    ? 'CSS_ANIMATION'
    : typeof CSSTransition !== 'undefined' && animation instanceof CSSTransition
      ? 'CSS_TRANSITION'
      : 'WEB_ANIMATION';
}
