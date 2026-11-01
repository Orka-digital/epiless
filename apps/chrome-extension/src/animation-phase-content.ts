import { type PhaseClock } from './animation-phase';
import {
  samplePhase,
  type AnimationPhaseSession,
} from './animation-phase-sampling';

/** Numeric, local-only timing. This does not intercept authors' animation APIs. */
export function createAnimationPhaseContent(
  discover: () => {
    roots: (Document | ShadowRoot)[];
    complete: boolean;
  },
) {
  let active: AnimationPhaseSession | undefined;
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
  function sample() {
    if (active) samplePhase(active, clock, reason);
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
