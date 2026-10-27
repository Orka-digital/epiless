import { MEDIA_POSITION_EPSILON_MS, type MediaEvidence } from './media-replay';

export interface MediaSeekEvent {
  atMs: number;
  timeMs: number;
  playbackRate: number;
  loop: boolean;
  paused: boolean;
}

/**
 * Browser loop seeking events can arrive after the timer already sampled the
 * head. Require the same bounded tail→head transition in both media clocks.
 * This proves an observed boundary, not whether a page script caused the seek.
 */
export function observedLoopSeeks(
  item: MediaEvidence['items'][number],
  events: MediaSeekEvent[],
): boolean {
  if (!events.length) return true;
  const { durationMs: duration, playbackRate: rate } = item.before;
  if (!item.before.loop || !duration || duration / rate <= 500) return false;
  const frames = item.presentations ?? [];
  const consumedSamples = new Set<number>();
  const consumedFrames = new Set<number>();
  const advances = (from: number, to: number, elapsed: number) =>
    elapsed >= 0 &&
    to >= from - MEDIA_POSITION_EPSILON_MS &&
    to - from <= elapsed * rate + MEDIA_POSITION_EPSILON_MS;
  for (const event of events) {
    if (
      !event.loop ||
      event.paused ||
      event.playbackRate !== rate ||
      event.timeMs > 250 * rate
    )
      return false;
    let matched = false;
    for (let index = 1; index < item.samples.length && !matched; index++) {
      const tail = item.samples[index - 1],
        head = item.samples[index];
      if (
        consumedSamples.has(index) ||
        tail.paused ||
        head.paused ||
        !tail.loop ||
        !head.loop ||
        tail.playbackRate !== rate ||
        head.playbackRate !== rate ||
        tail.timeMs < duration - 250 * rate ||
        head.timeMs > 250 * rate ||
        head.timeMs + MEDIA_POSITION_EPSILON_MS >= tail.timeMs ||
        tail.atMs > event.atMs ||
        Math.abs(head.atMs - event.atMs) > 250 ||
        head.atMs - tail.atMs > 250 ||
        !advances(tail.timeMs, duration + head.timeMs, head.atMs - tail.atMs) ||
        !advances(
          tail.timeMs,
          duration + event.timeMs,
          event.atMs - tail.atMs,
        ) ||
        !(event.atMs >= head.atMs
          ? advances(head.timeMs, event.timeMs, event.atMs - head.atMs)
          : advances(event.timeMs, head.timeMs, head.atMs - event.atMs))
      )
        continue;
      for (let frame = 1; frame < frames.length; frame++) {
        const previous = frames[frame - 1],
          next = frames[frame];
        if (
          consumedFrames.has(frame) ||
          previous.timeMs < duration - 250 * rate ||
          next.timeMs > 250 * rate ||
          next.timeMs + MEDIA_POSITION_EPSILON_MS >= previous.timeMs ||
          next.presentedFrames !== previous.presentedFrames + 1 ||
          next.atMs - previous.atMs > 250 ||
          previous.atMs > event.atMs + 250 ||
          next.atMs < event.atMs - 250 ||
          Math.abs(next.atMs - head.atMs) > 250
        )
          continue;
        consumedSamples.add(index);
        consumedFrames.add(frame);
        matched = true;
        break;
      }
    }
    // A second seeking event cannot reuse an already witnessed boundary.
    if (!matched) return false;
  }
  return true;
}
