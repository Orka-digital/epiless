import { mediaObservationProgress } from './media-observation-progress';
import { observeMediaPresentations } from './media-presentation-observer';
import {
  MEDIA_REPLAY_LIMIT,
  MEDIA_SAMPLE_INTERVAL_MS,
  MEDIA_SAMPLE_LIMIT,
  type MediaEvidence,
  type MediaPresentation,
  type MediaReplayPlan,
  type MediaSample,
  type MediaState,
} from './media-replay';

import {
  exceedsTimeLimit,
  sample,
  state,
  time,
  type ContentMediaOptions,
} from './media-element-state';
import { observedLoopSeeks, type MediaSeekEvent } from './media-loop-seek';

/** Own bounded media sampling and compositor evidence for one segment; disposal releases all observers and callbacks. */
export class MediaObservation {
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
      observeMediaPresentations(entry, {
        stopped: () => this.stopped,
        begun: () => this.begun,
        startedAt: () => this.startedAt,
        reason: (reason) => this.reasons.add(reason),
        remove: (remove) => this.removers.push(remove),
      });

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
    return mediaObservationProgress(this.entries, this.reasons, plan);
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
