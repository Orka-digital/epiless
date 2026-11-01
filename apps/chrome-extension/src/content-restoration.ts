import type { ContentMessage } from './content-message';
import type { ContentSession } from './content-session';
import { cancelSourceTimeline } from './source-timeline';
/** Restore remembered media settings without restarting playback or sound. */
export async function restoreContent(
  session: ContentSession,
  _message: ContentMessage,
) {
  const { control, originalMedia, mediaReplay, animationPhase } = session;

  cancelSourceTimeline();
  mediaReplay.cancel();
  animationPhase.cancel();
  control.cancelled = true;
  control.generation++;
  for (const [video, original] of originalMedia) {
    if (!video.isConnected) continue;
    video.pause();
    video.muted = original.muted;
    video.playbackRate = original.playbackRate;
    video.loop = original.loop;
    try {
      video.currentTime = original.time;
    } catch {
      /* Streaming media may not be seekable. */
    }
    // Never restart sound or playback during teardown.
  }
  originalMedia.clear();
  return { achieved: true };
}
