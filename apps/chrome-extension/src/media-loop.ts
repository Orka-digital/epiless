import {
  replayableMediaState,
  validMediaState,
  MEDIA_REPLAY_LIMIT,
  type MediaReplayPlan,
  type MediaState,
} from './media-replay';

export interface MediaSnapshot {
  complete: boolean;
  reasons: string[];
  items: MediaState[];
}

export const LOOP_OBSERVATION_MS = 5_000;
const MAX_LOOP_OBSERVATIONS = 2;

export const mediaTargetKey = (item: MediaState): string =>
  JSON.stringify(item.selectorPath);

/** Seek just before an existing loop boundary. Never turn a non-looping video
 * into a loop, change playback speed, fetch a source or expand display scale. */
export function planLoopBoundary(
  snapshot: MediaSnapshot,
  attempted: ReadonlySet<string>,
  supportedTargets: ReadonlySet<string>,
): { plan: MediaReplayPlan; targetKey: string } | { reason: string } {
  if (
    !snapshot.complete ||
    snapshot.reasons.length ||
    snapshot.items.length > MEDIA_REPLAY_LIMIT ||
    !snapshot.items.every(validMediaState)
  )
    return { reason: 'MEDIA_LOOP_DISCOVERY_INCOMPLETE' };
  const target = snapshot.items.find(
    (item) =>
      item.loop &&
      supportedTargets.has(mediaTargetKey(item)) &&
      !attempted.has(mediaTargetKey(item)),
  );
  if (!target) return { reason: 'NO_UNTESTED_LOOPING_VIDEO_DISCOVERED' };
  if (attempted.size >= MAX_LOOP_OBSERVATIONS)
    return { reason: 'MEDIA_LOOP_SAMPLE_LIMIT_REACHED' };
  // Replaying a seekable target while other visible/hidden media cannot be
  // restored would create an unrepeatable combined page state.
  if (!snapshot.items.every(replayableMediaState))
    return { reason: 'MEDIA_LOOP_REQUIRES_SEEKABLE_FILE_CONTEXT' };
  const duration = target.durationMs!;
  if (duration / target.playbackRate <= 500)
    return { reason: 'MEDIA_LOOP_TOO_SHORT_FOR_RELIABLE_TIME_SAMPLES' };
  const start = Math.max(0, duration - 1000 * target.playbackRate);
  if (!target.seekable.some(([a, b]) => a <= start && b >= duration))
    return { reason: 'MEDIA_LOOP_BOUNDARY_NOT_SEEKABLE' };
  const items = structuredClone(snapshot.items);
  const selected = items.find(
    (item) => mediaTargetKey(item) === mediaTargetKey(target),
  )!;
  selected.timeMs = start;
  selected.paused = false;
  return {
    targetKey: mediaTargetKey(target),
    plan: { version: 1, status: 'REPLAYABLE', reasons: [], items },
  };
}
