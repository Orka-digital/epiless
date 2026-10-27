import { structuralDiagnosticPath } from './source-diagnostics';
import {
  PHASE_ANIMATION_LIMIT,
  validPhaseClock,
  type AnimationPhaseRecord,
  type AnimationPhaseState,
  type PhaseClock,
  type PhaseEvidence,
} from './animation-phase';

/** Numeric, local-only timing. This does not intercept authors' animation APIs. */
export function createAnimationPhaseContent(
  discover: () => {
    roots: (Document | ShadowRoot)[];
    complete: boolean;
  },
) {
  let active:
    | {
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
    | undefined;
  const clock = (): PhaseClock => ({
    documentMs: performance.now(),
    timelineMs:
      typeof document.timeline.currentTime === 'number'
        ? document.timeline.currentTime
        : NaN,
    epochMs: performance.timeOrigin + performance.now(),
  });
  const reason = (value: string) => {
    if (!active) return;
    active.evidence.complete = false;
    active.evidence.reasons = [
      ...new Set([...active.evidence.reasons, value]),
    ].slice(0, 32);
  };
  const state = (
    animation: Animation,
    at: PhaseClock,
  ): AnimationPhaseState | undefined => {
    if (
      animation.timeline !== document.timeline ||
      !(animation.effect instanceof KeyframeEffect)
    ) {
      reason('ANIMATION_TIMELINE_UNSUPPORTED');
      return;
    }
    const timing = animation.effect.getTiming();
    // A pending start is sampled on the next genuine animation frame. Its
    // unresolved clock is never replaced with a guessed zero.
    if (
      animation.startTime === null ||
      animation.currentTime === null ||
      animation.pending
    )
      return;
    if (
      typeof animation.startTime !== 'number' ||
      typeof animation.currentTime !== 'number' ||
      typeof timing.duration !== 'number' ||
      !Number.isFinite(timing.duration) ||
      animation.playbackRate <= 0 ||
      animation.playbackRate > 16 ||
      Math.abs(animation.currentTime) > 86_400_000 ||
      Math.abs(animation.startTime) > 86_400_000 ||
      timing.duration > 86_400_000 ||
      Math.abs(timing.delay ?? 0) > 86_400_000
    ) {
      reason('ANIMATION_CLOCK_UNSUPPORTED');
      return;
    }
    return {
      clock: at,
      currentTimeMs: animation.currentTime,
      startTimeMs: animation.startTime,
      playbackRate: animation.playbackRate,
      playState: animation.playState,
      durationMs: timing.duration,
      delayMs: timing.delay ?? 0,
      iterations:
        timing.iterations === Infinity ? null : (timing.iterations ?? 1),
    };
  };
  function sample() {
    if (!active) return;
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
      if (!active.evidence.trigger) active.preTrigger.add(animation);
      const effect = animation.effect;
      if (
        !(effect instanceof KeyframeEffect) ||
        !(effect.target instanceof Element)
      ) {
        reason('ANIMATION_TARGET_UNAVAILABLE');
        continue;
      }
      const selectorPath = structuralDiagnosticPath(effect.target);
      if (!selectorPath) {
        reason('ANIMATION_TARGET_UNAVAILABLE');
        continue;
      }
      const kind =
        typeof CSSAnimation !== 'undefined' && animation instanceof CSSAnimation
          ? 'CSS_ANIMATION'
          : typeof CSSTransition !== 'undefined' &&
              animation instanceof CSSTransition
            ? 'CSS_TRANSITION'
            : 'WEB_ANIMATION';
      const key = JSON.stringify([selectorPath, kind]);
      const ordinal = ordinals.get(key) ?? 0;
      ordinals.set(key, ordinal + 1);
      const current = state(animation, at);
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
        continue;
      }
      active.unresolved.delete(animation);
      if (previous) {
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
      } else {
        if (active.records.size >= PHASE_ANIMATION_LIMIT) {
          reason('ANIMATION_PHASE_LIMIT_REACHED');
          continue;
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
  }
  function cancel() {
    if (!active) return;
    cancelAnimationFrame(active.frame);
    clearTimeout(active.watchdog);
    active = undefined;
  }
  const matches = (generation: string, segmentId: string) =>
    active?.generation === generation && active.segmentId === segmentId;
  return {
    clock,
    begin(generation: string, segmentId: string) {
      cancel();
      const at = clock(),
        found = discover();
      active = {
        generation,
        segmentId,
        evidence: {
          version: 1,
          complete: true,
          reasons: [],
          start: at,
          end: at,
          animations: [],
        },
        roots: found.roots.slice(0, 65),
        records: new Map(),
        preTrigger: new WeakSet(),
        unresolved: new Set(),
        discoveryOverflow: false,
        frame: 0,
        watchdog: setTimeout(cancel, 125_000),
        lastSample: at.documentMs,
      };
      if (!found.complete || found.roots.length > 65)
        reason('ANIMATION_DISCOVERY_INCOMPLETE');
      sample();
      const tick = () => {
        if (!active || !matches(generation, segmentId)) return;
        const elapsed = performance.now() - active.lastSample;
        if (
          elapsed >= 90 ||
          (active.evidence.trigger &&
            performance.now() - active.evidence.trigger.before.documentMs < 200)
        )
          sample();
        active.frame = requestAnimationFrame(tick);
      };
      active.frame = requestAnimationFrame(tick);
      return { begun: true };
    },
    trigger(generation: string, segmentId: string, stage: 'before' | 'after') {
      if (!matches(generation, segmentId)) return { marked: false };
      sample();
      if (stage === 'before') active!.evidence.trigger = { before: clock() };
      else if (active!.evidence.trigger) {
        active!.evidence.trigger.after = clock();
        sample();
      }
      return {
        marked: true,
        clock:
          stage === 'before'
            ? active!.evidence.trigger!.before
            : active!.evidence.trigger!.after,
      };
    },
    stop(generation: string, segmentId: string) {
      if (!matches(generation, segmentId)) return undefined;
      const found = discover();
      if (
        !found.complete ||
        found.roots.length !== active!.roots.length ||
        found.roots.some((root) => !active!.roots.includes(root))
      )
        reason('ANIMATION_DISCOVERY_CHANGED');
      sample();
      if (active!.unresolved.size) reason('ANIMATION_PHASE_UNRESOLVED');
      const evidence = active!.evidence;
      cancel();
      return evidence;
    },
    cancel,
  };
}
