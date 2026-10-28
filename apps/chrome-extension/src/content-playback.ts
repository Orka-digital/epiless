import { normalizePublicUrl } from '@epi-less/core';

import type { PageInventory } from './model';

import type { ContentMessage } from './content-message';
import type { ContentSession } from './content-session';
/** Start remembered muted media with bounded waits and require actual playback progress. */
export async function playContentMedia(
  session: ContentSession,
  _message: ContentMessage,
  element: HTMLVideoElement,
  kind: PageInventory['actions'][number]['kind'],
  generation: number,
  beforeUrl: string,
) {
  const { control, policy, rememberOriginalMedia } = session;
  const { controlState } = policy;

  rememberOriginalMedia(element);
  element.muted = true;
  let playTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const initialTime = element.currentTime;
    const initialFrames = element.getVideoPlaybackQuality().totalVideoFrames;
    await Promise.race([
      element.play(),
      new Promise<never>((_, reject) => {
        playTimeout = setTimeout(
          () => reject(new Error('PLAYBACK_TIMEOUT')),
          2500,
        );
      }),
    ]);
    const deadline = performance.now() + 1500;
    let progressed = false;
    while (
      performance.now() < deadline &&
      !control.cancelled &&
      generation === control.generation
    ) {
      progressed =
        element.currentTime > initialTime + 0.01 ||
        element.getVideoPlaybackQuality().totalVideoFrames > initialFrames;
      if (progressed) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const achieved =
      !control.cancelled &&
      generation === control.generation &&
      progressed &&
      !element.paused &&
      !element.ended;
    return {
      achieved,
      reason: achieved
        ? undefined
        : control.cancelled
          ? 'ACTION_CANCELLED'
          : 'MEDIA_PLAYBACK_NOT_PROGRESSING',
      fromUrl: beforeUrl,
      url: normalizePublicUrl(location.href),
      state: achieved ? controlState(element, kind) : undefined,
    };
  } catch {
    element.pause();
    return { achieved: false, reason: 'MEDIA_PLAYBACK_REFUSED' };
  } finally {
    if (playTimeout) clearTimeout(playTimeout);
  }
}
