import {
  resolveDiagnosticPath,
  structuralDiagnosticPath,
} from './source-diagnostics';
import {
  MEDIA_REPLAY_LIMIT,
  MEDIA_SAMPLE_INTERVAL_MS,
  MEDIA_SAMPLE_LIMIT,
  MEDIA_PRESENTATION_LIMIT,
  MEDIA_POSITION_EPSILON_MS,
  validMediaPlan,
  measuredMediaInterval,
  type MediaState,
  type MediaSample,
  type MediaEvidence,
  type MediaReplayPlan,
  type MediaPresentation,
} from './media-replay';
import { observedLoopSeeks, type MediaSeekEvent } from './media-loop-seek';

interface Discovery {
  videos: HTMLVideoElement[];
  roots: (Document | ShadowRoot)[];
  complete: boolean;
}
interface ContentMediaOptions {
  discover: () => Discovery;
  remember: (video: HTMLVideoElement) => void;
}
const time = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(86_400_000, value * 1000)) : 0;
function exceedsTimeLimit(video: HTMLVideoElement): boolean {
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
async function state(video: HTMLVideoElement): Promise<MediaState> {
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
const sample = (video: HTMLVideoElement, atMs: number): MediaSample => ({
  atMs,
  timeMs: time(video.currentTime),
  paused: video.paused,
  ended: video.ended,
  seeking: video.seeking,
  playbackRate: video.playbackRate,
  loop: video.loop,
});
const samePath = (a: string[], b: string[]) =>
  JSON.stringify(a) === JSON.stringify(b);

class MediaObservation {
  readonly reasons = new Set<string>();
  readonly entries: {
    video: HTMLVideoElement;
    before: MediaState;
    samples: MediaSample[];
    presentations: MediaPresentation[];
    seeks: MediaSeekEvent[];
    presentation?: MediaSample['presentation'];
  }[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private observer?: MutationObserver;
  private watchdog?: ReturnType<typeof setTimeout>;
  private removers: (() => void)[] = [];
  private startedAt = performance.now();
  private stopped = false;
  private begun = false;
  private startedEpochMs?: number;
  constructor(
    readonly generation: string,
    readonly segmentId: string,
    private options: ContentMediaOptions,
  ) {}
  async start() {
    this.watchdog = setTimeout(() => {
      this.reasons.add('MEDIA_OBSERVATION_TIMEOUT');
      this.cancel();
    }, 125_000);
    const discovered = this.options.discover();
    if (!discovered.complete) this.reasons.add('MEDIA_DISCOVERY_INCOMPLETE');
    if (discovered.videos.length > MEDIA_REPLAY_LIMIT)
      this.reasons.add('MEDIA_LIMIT_REACHED');
    this.observer = new MutationObserver((records) => {
      for (const record of records) {
        if (
          record.type === 'attributes' &&
          (record.target instanceof HTMLVideoElement ||
            record.target instanceof HTMLSourceElement)
        )
          this.reasons.add('MEDIA_SOURCE_OR_LOOP_CHANGED');
        for (const node of [...record.addedNodes, ...record.removedNodes])
          if (
            node instanceof Element &&
            (node.matches('video,source') ||
              node.querySelector('video,source') ||
              this.entries.some((entry) => node.contains(entry.video)))
          )
            this.reasons.add('MEDIA_MEMBERSHIP_CHANGED');
      }
    });
    for (const root of discovered.roots)
      this.observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'loop'],
      });
    // Observe membership before the asynchronous SHA operation. Transient added
    // and removed media must not disappear from the completeness record.
    this.startedAt = performance.now();
    for (const video of discovered.videos.slice(0, MEDIA_REPLAY_LIMIT)) {
      if (exceedsTimeLimit(video)) this.reasons.add('MEDIA_TIME_LIMIT_REACHED');
      for (const name of [
        'emptied',
        'loadstart',
        'ratechange',
        'durationchange',
      ]) {
        const listener = () => this.reasons.add('MEDIA_SOURCE_OR_RATE_CHANGED');
        video.addEventListener(name, listener);
        this.removers.push(() => video.removeEventListener(name, listener));
      }
      const before = await state(video);
      if (!before.selectorPath.length)
        this.reasons.add('MEDIA_PATH_UNAVAILABLE');
      if (this.stopped) return;
      const entry: MediaObservation['entries'][number] = {
        video,
        before,
        samples: [],
        presentations: [],
        seeks: [],
      };
      this.entries.push(entry);
      const seek = () => {
        if (!this.begun) return;
        const event: MediaSeekEvent = {
          atMs: performance.now() - this.startedAt,
          timeMs: time(video.currentTime),
          playbackRate: video.playbackRate,
          loop: video.loop,
          paused: video.paused,
        };
        if (
          !before.loop ||
          !before.durationMs ||
          before.durationMs / before.playbackRate <= 500 ||
          !event.loop ||
          event.paused ||
          event.playbackRate !== before.playbackRate ||
          event.timeMs > 250 * before.playbackRate
        )
          this.reasons.add('MEDIA_SEEK_DURING_OBSERVATION');
        else if (entry.seeks.length >= MEDIA_SAMPLE_LIMIT)
          this.reasons.add('MEDIA_SEEK_LIMIT_REACHED');
        else entry.seeks.push(event);
      };
      video.addEventListener('seeking', seek);
      this.removers.push(() => video.removeEventListener('seeking', seek));
      if (typeof video.requestVideoFrameCallback === 'function') {
        let callbackId: number;
        const frame: VideoFrameRequestCallback = (_now, metadata) => {
          if (this.stopped) return;
          if (!this.begun) {
            callbackId = video.requestVideoFrameCallback(frame);
            return;
          }
          const mediaTime = time(metadata.mediaTime);
          if (entry.presentations.length >= MEDIA_PRESENTATION_LIMIT)
            this.reasons.add('MEDIA_PRESENTATION_LIMIT_REACHED');
          else
            entry.presentations.push({
              atMs: performance.now() - this.startedAt,
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
            this.reasons.add('MEDIA_PRESENTATION_DISCONTINUITY');
          entry.presentation = {
            timeMs: mediaTime,
            count: (previous?.count ?? 0) + 1,
            wraps: (previous?.wraps ?? 0) + (wrapped ? 1 : 0),
          };
          callbackId = video.requestVideoFrameCallback(frame);
        };
        callbackId = video.requestVideoFrameCallback(frame);
        this.removers.push(() => video.cancelVideoFrameCallback(callbackId));
      }
      if (this.stopped) return;
    }
  }
  begin() {
    if (this.stopped || this.begun) return { begun: false };
    this.startedAt = performance.now();
    this.startedEpochMs = performance.timeOrigin + this.startedAt;
    this.begun = true;
    for (const entry of this.entries) {
      entry.before.timeMs = time(entry.video.currentTime);
      entry.before.paused = entry.video.paused;
      entry.samples = [];
      entry.presentations = [];
      entry.seeks = [];
      entry.presentation = undefined;
    }
    this.read();
    this.timer = setInterval(() => this.read(), MEDIA_SAMPLE_INTERVAL_MS);
    return { begun: true };
  }
  private read() {
    if (this.stopped || !this.begun) return;
    const atMs = performance.now() - this.startedAt;
    if (atMs > 125_000) {
      this.reasons.add('MEDIA_OBSERVATION_TIMEOUT');
      this.cancel();
      return;
    }
    for (const entry of this.entries) {
      if (exceedsTimeLimit(entry.video))
        this.reasons.add('MEDIA_TIME_LIMIT_REACHED');
      if (!entry.video.isConnected) this.reasons.add('MEDIA_NODE_REPLACED');
      if (entry.samples.length >= MEDIA_SAMPLE_LIMIT) {
        this.reasons.add('MEDIA_SAMPLE_LIMIT_REACHED');
        continue;
      }
      entry.samples.push({
        ...sample(entry.video, atMs),
        ...(entry.presentation
          ? { presentation: { ...entry.presentation } }
          : {}),
      });
    }
  }
  progress(plan: MediaReplayPlan) {
    this.read();
    const intervals = this.entries.map((entry) =>
      measuredMediaInterval({
        before: entry.before,
        after: entry.before,
        samples: entry.samples,
        presentations: entry.presentations,
      }),
    );
    return {
      covered:
        this.reasons.size === 0 &&
        this.entries.every((entry) =>
          observedLoopSeeks(
            {
              before: entry.before,
              after: entry.before,
              samples: entry.samples,
              presentations: entry.presentations,
            },
            entry.seeks,
          ),
        ) &&
        Boolean(plan.coverage) &&
        plan.coverage!.length === intervals.length &&
        intervals.every(
          (interval, index) =>
            interval &&
            interval.endMs >=
              plan.coverage![index].endMs - MEDIA_POSITION_EPSILON_MS &&
            interval.wraps >= plan.coverage![index].wraps &&
            (plan.coverage![index].presentedEndMs === undefined ||
              (interval.presentedEndMs !== undefined &&
                interval.presentedEndMs >=
                  plan.coverage![index].presentedEndMs! -
                    MEDIA_POSITION_EPSILON_MS &&
                interval.presentedWraps >=
                  (plan.coverage![index].presentedWraps ?? 0))),
        ),
    };
  }
  cancel() {
    this.reasons.add('MEDIA_OBSERVATION_CANCELLED');
    this.dispose();
  }
  private dispose() {
    this.stopped = true;
    clearInterval(this.timer);
    clearTimeout(this.watchdog);
    this.observer?.disconnect();
    for (const remove of this.removers) remove();
    this.removers = [];
  }
  async finish(): Promise<MediaEvidence> {
    this.read();
    const endedEpochMs = performance.timeOrigin + performance.now();
    if (!this.begun) this.reasons.add('MEDIA_CAPTURE_BOUNDARY_UNAVAILABLE');
    this.dispose();
    const discovered = this.options.discover();
    if (!discovered.complete) this.reasons.add('MEDIA_DISCOVERY_INCOMPLETE');
    if (
      discovered.videos.length !== this.entries.length ||
      discovered.videos.some(
        (video, index) => video !== this.entries[index]?.video,
      )
    )
      this.reasons.add('MEDIA_MEMBERSHIP_CHANGED');
    const items = await Promise.all(
      this.entries.map(async (entry) => ({
        before: entry.before,
        after: await state(entry.video),
        samples: entry.samples,
        presentations: entry.presentations,
      })),
    );
    for (const [index, entry] of this.entries.entries())
      if (!observedLoopSeeks(items[index], entry.seeks))
        this.reasons.add('MEDIA_LOOP_SEEK_UNPROVEN');
    return {
      version: 1,
      complete: this.reasons.size === 0,
      ...(this.startedEpochMs === undefined
        ? {}
        : { startedEpochMs: this.startedEpochMs, endedEpochMs }),
      reasons: [...this.reasons].slice(0, 32),
      items,
    };
  }
}

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
      if (
        !final.complete ||
        final.videos.length !== discovered.videos.length ||
        final.videos.some((video, i) => video !== discovered.videos[i])
      )
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
        if (
          ownRevision !== revision ||
          actual.sourceKind !== 'URL' ||
          actual.locatorSha256 !== expected.locatorSha256 ||
          actual.durationMs !== expected.durationMs ||
          actual.playbackRate !== expected.playbackRate ||
          actual.loop !== expected.loop ||
          !actual.seekable.some(
            ([start, end]) =>
              start <= expected.timeMs && end >= expected.timeMs,
          )
        )
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
          !video.isConnected ||
          video.seeking ||
          !samePath(reached.selectorPath, expected.selectorPath) ||
          reached.locatorSha256 !== expected.locatorSha256 ||
          Math.abs(reached.timeMs - expected.timeMs) > MEDIA_POSITION_EPSILON_MS
        )
          return { achieved: false, reason: 'MEDIA_REPLAY_SEEK_UNREACHED' };
        pending.push({ video, expected });
      }
      if (ownRevision !== revision)
        return { achieved: false, reason: 'MEDIA_REPLAY_CANCELLED' };
      const final = options.discover();
      if (
        !final.complete ||
        final.videos.length !== discovered.videos.length ||
        final.videos.some((video, i) => video !== discovered.videos[i])
      )
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
