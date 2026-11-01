import { structuralDiagnosticPath } from './source-diagnostics';

import { type MediaSample, type MediaState } from './media-replay';

interface Discovery {
  videos: HTMLVideoElement[];
  roots: (Document | ShadowRoot)[];
  complete: boolean;
}

export interface ContentMediaOptions {
  discover: () => Discovery;
  remember: (video: HTMLVideoElement) => void;
}

export const time = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(86_400_000, value * 1000)) : 0;

/** Check duration, current time and bounded seek ranges against the supported one-day media clock. */
export function exceedsTimeLimit(video: HTMLVideoElement): boolean {
  if (video.duration > 86_400 && Number.isFinite(video.duration)) return true;
  if (video.currentTime > 86_400) return true;
  for (let index = 0; index < Math.min(16, video.seekable.length); index++)
    if (
      video.seekable.start(index) > 86_400 ||
      video.seekable.end(index) > 86_400
    )
      return true;
  return false;
}

/** Snapshot media identity using a locator hash; never return the raw source URL or fetch media. */
export async function state(video: HTMLVideoElement): Promise<MediaState> {
  const locator = video.currentSrc;
  let locatorSha256: string | undefined;
  if (!video.srcObject && locator)
    locatorSha256 = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(locator),
        ),
      ),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
  const seekable: [number, number][] = [];
  for (let index = 0; index < Math.min(16, video.seekable.length); index++)
    seekable.push([
      time(video.seekable.start(index)),
      time(video.seekable.end(index)),
    ]);
  return {
    selectorPath: structuralDiagnosticPath(video) ?? [],
    ...(locatorSha256 ? { locatorSha256 } : {}),
    sourceKind: video.srcObject
      ? 'STREAM'
      : locatorSha256
        ? 'URL'
        : 'UNAVAILABLE',
    durationMs:
      Number.isFinite(video.duration) && video.duration <= 86_400
        ? time(video.duration)
        : null,
    timeMs: time(video.currentTime),
    playbackRate: video.playbackRate,
    loop: video.loop,
    paused: video.paused,
    seekable,
  };
}

export const sample = (video: HTMLVideoElement, atMs: number): MediaSample => ({
  atMs,
  timeMs: time(video.currentTime),
  paused: video.paused,
  ended: video.ended,
  seeking: video.seeking,
  playbackRate: video.playbackRate,
  loop: video.loop,
});

export const samePath = (a: string[], b: string[]) =>
  JSON.stringify(a) === JSON.stringify(b);
