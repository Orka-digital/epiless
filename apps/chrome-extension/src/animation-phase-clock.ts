import { type AnimationPhaseState, type PhaseClock } from './animation-phase';

/** Read a finite replayable animation clock; record unsupported timing rather than inventing phase evidence. */
export function readAnimationState(
  animation: Animation,
  at: PhaseClock,
  reason: (value: string) => void,
): AnimationPhaseState | undefined {
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
}
