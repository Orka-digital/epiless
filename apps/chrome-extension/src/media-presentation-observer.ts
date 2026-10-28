import { time } from './media-element-state';
import type { MediaObservation } from './media-observation';
import {
  MEDIA_POSITION_EPSILON_MS,
  MEDIA_PRESENTATION_LIMIT,
} from './media-replay';
/** Retain bounded compositor callbacks; the owner supplies live cancellation and capture boundaries. */
export function observeMediaPresentations(
  entry: MediaObservation['entries'][number],
  owner: {
    stopped(): boolean;
    begun(): boolean;
    startedAt(): number;
    reason(reason: string): void;
    remove(remove: () => void): void;
  },
): void {
  const { video, before } = entry;
  if (typeof video.requestVideoFrameCallback === 'function') {
    let callbackId: number;
    const frame: VideoFrameRequestCallback = (_now, metadata) => {
      if (owner.stopped()) return;
      if (!owner.begun()) {
        callbackId = video.requestVideoFrameCallback(frame);
        return;
      }
      const mediaTime = time(metadata.mediaTime);
      if (entry.presentations.length >= MEDIA_PRESENTATION_LIMIT)
        owner.reason('MEDIA_PRESENTATION_LIMIT_REACHED');
      else
        entry.presentations.push({
          atMs: performance.now() - owner.startedAt(),
          timeMs: mediaTime,
          presentedFrames: metadata.presentedFrames,
        });
      const previous = entry.presentation;
      const wrapped =
        previous && mediaTime + MEDIA_POSITION_EPSILON_MS < previous.timeMs;
      if (
        wrapped &&
        (!before.loop ||
          !before.durationMs ||
          previous.timeMs < before.durationMs - 250 * before.playbackRate ||
          mediaTime > 250 * before.playbackRate)
      )
        owner.reason('MEDIA_PRESENTATION_DISCONTINUITY');
      entry.presentation = {
        timeMs: mediaTime,
        count: (previous?.count ?? 0) + 1,
        wraps: (previous?.wraps ?? 0) + (wrapped ? 1 : 0),
      };
      callbackId = video.requestVideoFrameCallback(frame);
    };
    callbackId = video.requestVideoFrameCallback(frame);
    owner.remove(() => video.cancelVideoFrameCallback(callbackId));
  }
}
