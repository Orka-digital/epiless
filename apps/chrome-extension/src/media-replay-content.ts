import { resolveDiagnosticPath } from './source-diagnostics';

import {
  MEDIA_POSITION_EPSILON_MS,
  MEDIA_REPLAY_LIMIT,
  validMediaPlan,
  type MediaEvidence,
  type MediaReplayPlan,
  type MediaState,
} from './media-replay';

import {
  exceedsTimeLimit,
  samePath,
  state,
  time,
  type ContentMediaOptions,
} from './media-element-state';
import { MediaObservation } from './media-observation';

/** Local-only bounded media control. No fetch, source URL export or stream seek. */
export function createMediaReplayContent(options: ContentMediaOptions) {
  let observation: MediaObservation | undefined;
  let revision = 0;
  let prepared: { video: HTMLVideoElement; expected: MediaState }[] = [];
  const controlled = new Set<HTMLVideoElement>();
  const cancel = () => {
    revision++;
    prepared = [];
    observation?.cancel();
    observation = undefined;
    for (const video of controlled) video.pause();
    controlled.clear();
  };
  return {
    cancel,
    async snapshot() {
      const discovered = options.discover();
      const reasons = [
        ...(!discovered.complete ? ['MEDIA_DISCOVERY_INCOMPLETE'] : []),
        ...(discovered.videos.length > MEDIA_REPLAY_LIMIT
          ? ['MEDIA_LIMIT_REACHED']
          : []),
        ...(discovered.videos
          .slice(0, MEDIA_REPLAY_LIMIT)
          .some(exceedsTimeLimit)
          ? ['MEDIA_TIME_LIMIT_REACHED']
          : []),
      ];
      const items = await Promise.all(
        discovered.videos.slice(0, MEDIA_REPLAY_LIMIT).map(state),
      );
      const final = options.discover();
      if (!sameMediaMembership(final, discovered.videos))
        reasons.push('MEDIA_MEMBERSHIP_CHANGED');
      return { complete: reasons.length === 0, reasons, items };
    },
    progress(generation: string, segmentId: string, plan: unknown) {
      return observation?.generation === generation &&
        observation.segmentId === segmentId &&
        validMediaPlan(plan)
        ? observation.progress(plan)
        : { covered: false };
    },
    async start(generation: string, segmentId: string) {
      observation?.cancel();
      const current = new MediaObservation(generation, segmentId, options);
      observation = current;
      await current.start();
      if (observation !== current) current.cancel();
      return { started: observation === current };
    },
    begin(generation: string, segmentId: string) {
      return observation?.generation === generation &&
        observation.segmentId === segmentId
        ? observation.begin()
        : { begun: false };
    },
    async stop(generation: string, segmentId: string): Promise<MediaEvidence> {
      if (
        !observation ||
        observation.generation !== generation ||
        observation.segmentId !== segmentId
      )
        return {
          version: 1,
          complete: false,
          reasons: ['MEDIA_OBSERVATION_UNAVAILABLE'],
          items: [],
        };
      const current = observation;
      observation = undefined;
      return current.finish();
    },
    async prepare(
      input: unknown,
    ): Promise<{ achieved: boolean; reason?: string }> {
      const ownRevision = ++revision;
      prepared = [];
      if (!validMediaPlan(input) || input.status !== 'REPLAYABLE')
        return { achieved: false, reason: 'MEDIA_REPLAY_PLAN_UNSUPPORTED' };
      const plan: MediaReplayPlan = input;
      const discovered = options.discover();
      if (
        !discovered.complete ||
        discovered.videos.length !== plan.items.length
      )
        return { achieved: false, reason: 'MEDIA_REPLAY_DISCOVERY_MISMATCH' };
      const pending: typeof prepared = [];
      const deadline = performance.now() + 2500;
      for (const expected of plan.items) {
        const video = resolveDiagnosticPath(expected.selectorPath);
        if (
          !(video instanceof HTMLVideoElement) ||
          !discovered.videos.includes(video)
        )
          return { achieved: false, reason: 'MEDIA_REPLAY_TARGET_MISSING' };
        if (exceedsTimeLimit(video))
          return { achieved: false, reason: 'MEDIA_TIME_LIMIT_REACHED' };
        const actual = await state(video);
        if (ownRevision !== revision || !matchesReplayState(actual, expected))
          return {
            achieved: false,
            reason: 'MEDIA_REPLAY_SOURCE_OR_STATE_CHANGED',
          };
        options.remember(video);
        controlled.add(video);
        video.pause();
        video.muted = true;
        if (
          Math.abs(time(video.currentTime) - expected.timeMs) >
          MEDIA_POSITION_EPSILON_MS
        )
          video.currentTime = expected.timeMs / 1000;
        while (
          video.seeking &&
          performance.now() < deadline &&
          ownRevision === revision
        )
          await new Promise((resolve) => setTimeout(resolve, 20));
        const reached = await state(video);
        if (
          performance.now() >= deadline ||
          ownRevision !== revision ||
          !reachedReplaySeek(video, reached, expected)
        )
          return { achieved: false, reason: 'MEDIA_REPLAY_SEEK_UNREACHED' };
        pending.push({ video, expected });
      }
      if (ownRevision !== revision)
        return { achieved: false, reason: 'MEDIA_REPLAY_CANCELLED' };
      const final = options.discover();
      if (!sameMediaMembership(final, discovered.videos))
        return { achieved: false, reason: 'MEDIA_REPLAY_MEMBERSHIP_CHANGED' };
      prepared = pending;
      return { achieved: true };
    },
    async release(): Promise<{ achieved: boolean; reason?: string }> {
      const ownRevision = revision;
      const pending = prepared;
      prepared = [];
      const deadline = performance.now() + 1500;
      for (const { video, expected } of pending) {
        const actual = await state(video);
        if (
          ownRevision !== revision ||
          !video.isConnected ||
          actual.locatorSha256 !== expected.locatorSha256 ||
          actual.playbackRate !== expected.playbackRate ||
          actual.loop !== expected.loop ||
          Math.abs(actual.timeMs - expected.timeMs) > MEDIA_POSITION_EPSILON_MS
        )
          return {
            achieved: false,
            reason: 'MEDIA_REPLAY_PRECONDITION_CHANGED',
          };
        if (!expected.paused) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          let failed = false;
          try {
            const remaining = deadline - performance.now();
            if (remaining <= 0) throw new Error('MEDIA_PLAY_TIMEOUT');
            const playing = video.play();
            void playing.then(
              () => {
                if (failed || ownRevision !== revision) video.pause();
              },
              () => {},
            );
            await Promise.race([
              playing,
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error('MEDIA_PLAY_TIMEOUT')),
                  remaining,
                );
              }),
            ]);
          } catch {
            failed = true;
            video.pause();
            return { achieved: false, reason: 'MEDIA_REPLAY_RESUME_FAILED' };
          } finally {
            clearTimeout(timer);
          }
          if (ownRevision !== revision || video.paused)
            return { achieved: false, reason: 'MEDIA_REPLAY_CANCELLED' };
        }
      }
      return { achieved: true };
    },
  };
}

function matchesReplayState(actual: MediaState, expected: MediaState): boolean {
  return !(
    actual.sourceKind !== 'URL' ||
    actual.locatorSha256 !== expected.locatorSha256 ||
    actual.durationMs !== expected.durationMs ||
    actual.playbackRate !== expected.playbackRate ||
    actual.loop !== expected.loop ||
    !actual.seekable.some(
      ([start, end]) => start <= expected.timeMs && end >= expected.timeMs,
    )
  );
}

function reachedReplaySeek(
  video: HTMLVideoElement,
  reached: MediaState,
  expected: MediaState,
): boolean {
  return !(
    !video.isConnected ||
    video.seeking ||
    !samePath(reached.selectorPath, expected.selectorPath) ||
    reached.locatorSha256 !== expected.locatorSha256 ||
    Math.abs(reached.timeMs - expected.timeMs) > MEDIA_POSITION_EPSILON_MS
  );
}

function sameMediaMembership(
  final: ReturnType<ContentMediaOptions['discover']>,
  videos: HTMLVideoElement[],
): boolean {
  return (
    final.complete &&
    final.videos.length === videos.length &&
    final.videos.every((video, i) => video === videos[i])
  );
}
