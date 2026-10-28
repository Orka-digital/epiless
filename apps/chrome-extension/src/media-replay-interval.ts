import {
  MEDIA_POSITION_EPSILON_MS,
  type MediaEvidence,
  type MediaPresentation,
  type MediaSample,
  type MediaState,
} from './media-replay-types';
import { sameSource } from './media-replay-validation';

/** Actual compositor submissions, kept separate from the advancing playback
 * clock. A stream of callbacks/counters alone cannot prove decoded clip coverage. */
export function presentedSequence(
  item: MediaEvidence['items'][number],
): { points: number[]; wraps: number } | undefined {
  const frames = item.presentations ?? [];
  const samples = item.samples;
  const first = samples[0],
    last = samples.at(-1);
  if (!first || !last) return;
  const stationary = samples.every(
    (sample) =>
      (sample.paused || sample.ended) &&
      Math.abs(sample.timeMs - first.timeMs) <= MEDIA_POSITION_EPSILON_MS,
  );
  if (stationary && frames.length <= 1)
    return { points: frames.map((frame) => frame.timeMs), wraps: 0 };
  if (frames.length < 2) return;
  let offset = 0,
    wraps = 0;
  const points: number[] = [];
  for (const [index, frame] of frames.entries()) {
    if (
      frame.atMs < first.atMs ||
      frame.atMs > last.atMs + MEDIA_POSITION_EPSILON_MS
    )
      return;
    const previous = frames[index - 1];
    if (previous) {
      // Gaps in the browser's own counter are missed presentation callbacks.
      // Do not infer their media PTS from the count.
      if (frame.presentedFrames !== previous.presentedFrames + 1) return;
      if (frame.timeMs + MEDIA_POSITION_EPSILON_MS < previous.timeMs) {
        const duration = item.before.durationMs;
        if (
          !item.before.loop ||
          !duration ||
          duration / item.before.playbackRate <= 500 ||
          previous.timeMs < duration - 250 * item.before.playbackRate ||
          frame.timeMs > 250 * item.before.playbackRate
        )
          return;
        offset += duration;
        wraps++;
      } else if (frame.timeMs <= previous.timeMs + MEDIA_POSITION_EPSILON_MS)
        return;
    }
    points.push(offset + frame.timeMs);
  }
  // While playback is moving, stale/missing compositor evidence >250ms is
  // unsupported, even if currentTime advances and tabCapture itself is healthy.
  if (!hasFreshPresentations(samples, frames)) return;
  return { points, wraps };
}

/** Returns the genuinely observed unwrapped media interval, never elapsed wall time. */
export function measuredMediaInterval(item: MediaEvidence['items'][number]):
  | {
      startMs: number;
      endMs: number;
      wraps: number;
      presentedWraps: number;
      presentations: number;
      presentedEndMs?: number;
    }
  | undefined {
  if (!sameSource(item.before, item.after)) return;
  const first = item.samples[0];
  if (!first) return;
  let previous = first,
    offset = 0,
    lastProgressAt = first.atMs,
    wraps = 0;
  let presentation = first.presentation;
  for (const sample of item.samples.slice(1)) {
    const deltaAt = sample.atMs - previous.atMs;
    if (sample.presentation) {
      if (regressedPresentation(presentation, sample.presentation)) return;
      presentation = sample.presentation;
    }
    if (
      sample.playbackRate !== item.before.playbackRate ||
      sample.loop !== item.before.loop ||
      deltaAt > 250
    )
      return;
    let advance = sample.timeMs - previous.timeMs;
    const wrapped = sample.timeMs + MEDIA_POSITION_EPSILON_MS < previous.timeMs;
    if (wrapped) {
      const duration = item.before.durationMs;
      if (!validSampleWrap(item.before, previous, sample, duration)) return;
      advance += duration;
      offset += duration;
      wraps++;
    }
    // A seek may start and finish between timer samples. Neither a missing
    // seeking flag nor later coverage can justify skipping unseen content.
    if (advance > deltaAt * sample.playbackRate + MEDIA_POSITION_EPSILON_MS)
      return;
    if (unexplainedSeek(sample, previous, first, item.before, wrapped)) return;
    lastProgressAt = sampleProgressTime(sample, previous, lastProgressAt);
    if (!sample.paused && !sample.ended && sample.atMs - lastProgressAt > 250)
      return;
    previous = sample;
  }
  const presented = presentedSequence(item);
  if (!presented) return;
  return {
    startMs: first.timeMs,
    endMs: offset + previous.timeMs,
    wraps,
    presentedWraps: presented.wraps,
    presentations: presented.points.length,
    ...(presented.points.length
      ? { presentedEndMs: presented.points.at(-1)! }
      : {}),
  };
}

function hasFreshPresentations(
  samples: MediaSample[],
  frames: MediaPresentation[],
): boolean {
  let cursor = -1,
    playingSince: number | undefined;
  for (const sample of samples) {
    while (cursor + 1 < frames.length && frames[cursor + 1].atMs <= sample.atMs)
      cursor++;
    if (sample.paused || sample.ended) {
      playingSince = undefined;
      continue;
    }
    playingSince ??= sample.atMs;
    if (
      sample.atMs - playingSince > 250 &&
      (cursor < 0 || sample.atMs - frames[cursor].atMs > 250)
    )
      return false;
  }
  return true;
}

function regressedPresentation(
  presentation: MediaSample['presentation'],
  next: NonNullable<MediaSample['presentation']>,
): boolean {
  return Boolean(
    presentation &&
    (next.count < presentation.count ||
      next.wraps < presentation.wraps ||
      (next.count === presentation.count &&
        (next.timeMs !== presentation.timeMs ||
          next.wraps !== presentation.wraps))),
  );
}

function unexplainedSeek(
  sample: MediaSample,
  previous: MediaSample,
  first: MediaSample,
  before: MediaState,
  wrapped: boolean,
): boolean {
  return (
    sample.seeking &&
    !wrapped &&
    Math.abs(sample.timeMs - first.timeMs) > MEDIA_POSITION_EPSILON_MS &&
    !(
      before.loop &&
      sample.timeMs <= MEDIA_POSITION_EPSILON_MS &&
      previous.timeMs <= 250 * sample.playbackRate
    )
  );
}

function validSampleWrap(
  before: MediaState,
  previous: MediaSample,
  sample: MediaSample,
  duration: number | null,
): duration is number {
  if (
    !before.loop ||
    !duration ||
    previous.timeMs < duration - 250 * sample.playbackRate ||
    sample.timeMs > 250 * sample.playbackRate ||
    duration / sample.playbackRate <= 500
  )
    return false;
  return true;
}

function sampleProgressTime(
  sample: MediaSample,
  previous: MediaSample,
  lastProgressAt: number,
): number {
  if (sample.timeMs !== previous.timeMs || sample.paused || sample.ended)
    return sample.atMs;
  return lastProgressAt;
}
