import { diagnosticContext } from './source-diagnostics';

import {
  SOURCE_TIMELINE_INTERVAL_MS,
  SourceTimelineBuffer,
  type TimelineTargetSample,
} from './source-timeline-core';
import { epoch } from './timeline-observation';

/** Own bounded DOM/media discovery and resource lifetime for one timeline. */
export abstract class TimelineDiscovery {
  readonly buffer: SourceTimelineBuffer;

  protected timer: ReturnType<typeof setInterval>;

  protected animationFrame = 0;

  protected stopped = false;

  protected lastSampleAt = -Infinity;

  protected lastAnimationTick = -Infinity;

  protected observer: MutationObserver;

  protected roots = new Set<Document | ShadowRoot>();

  protected changed = new Set<Element>();

  protected counts = new WeakMap<Element, number>();

  protected tokens = new WeakMap<Element, string>();

  protected limitations = new Set<string>();

  protected media: Element[] = [];

  protected lastDiscovery = -Infinity;

  protected lastTargetDiscovery = -Infinity;

  protected discoveredTargets: Element[] = [];

  protected structureRevision = 0;

  protected paths = new WeakMap<
    Element,
    { revision: number; path: string[] }
  >();

  protected videoCallbacks = new Map<HTMLVideoElement, number>();

  protected videoPresentations = new WeakMap<
    HTMLVideoElement,
    NonNullable<TimelineTargetSample['videoPresentation']>
  >();

  protected startedAt = epoch();

  constructor(
    readonly generation: string,
    readonly segmentId: string,
  ) {
    this.buffer = new SourceTimelineBuffer(
      generation,
      segmentId,
      diagnosticContext(),
    );
    this.observer = new MutationObserver((records) => {
      if (records.length > 1000) {
        this.limitations.add('MUTATION_BATCH_LIMIT_REACHED');
        // Omitted records may include a child-list change: invalidate cached paths.
        this.structureRevision++;
      }
      for (const record of records.slice(0, 1000)) {
        if (record.type === 'childList') this.structureRevision++;
        let target =
          record.target instanceof Element
            ? record.target
            : record.target.parentElement;
        for (
          let depth = 0;
          target && depth < 4;
          depth++, target = target.parentElement
        ) {
          this.counts.set(
            target,
            Math.min(10_000, (this.counts.get(target) ?? 0) + 1),
          );
          if (this.changed.size < 64) this.changed.add(target);
          else this.limitations.add('MUTATION_TARGET_LIMIT_REACHED');
        }
      }
    });
    this.addRoot(document);
    this.sample('INITIAL');
    const tick = (renderMs: number) => {
      if (this.stopped) return;
      this.lastAnimationTick = performance.now();
      if (
        performance.now() - this.lastSampleAt >=
        SOURCE_TIMELINE_INTERVAL_MS - 0.5
      )
        this.sample('ANIMATION_FRAME', performance.timeOrigin + renderMs);
      if (!this.stopped) this.animationFrame = requestAnimationFrame(tick);
    };
    this.animationFrame = requestAnimationFrame(tick);
    // Inactive/occluded pages may throttle rAF. Preserve honest timer observations,
    // identified individually; never call them compositor-synchronized samples.
    this.timer = setInterval(() => {
      if (
        performance.now() - this.lastAnimationTick > 100 &&
        performance.now() - this.lastSampleAt >= 100
      )
        this.sample('TIMER_FALLBACK');
    }, 100);
  }

  protected addRoot(root: Document | ShadowRoot) {
    if (this.roots.has(root)) return;
    if (this.roots.size >= 16) {
      this.limitations.add('TIMELINE_SHADOW_ROOT_LIMIT_REACHED');
      return;
    }
    this.roots.add(root);
    this.observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
    });
  }

  protected discover(deadline: number) {
    for (const [video, callback] of this.videoCallbacks)
      if (!video.isConnected) {
        video.cancelVideoFrameCallback(callback);
        this.videoCallbacks.delete(video);
      }
    this.media = [];
    let visited = 0;
    for (const root of this.roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (performance.now() > deadline) {
          this.limitations.add('TIMELINE_DISCOVERY_WORK_TRUNCATED');
          return;
        }
        if (++visited > 4_000) {
          this.limitations.add('TIMELINE_DISCOVERY_LIMIT_REACHED');
          return;
        }
        const element = node as Element;
        this.discoverElement(element);
      }
    }
  }

  private discoverElement(element: Element): void {
    if (element.shadowRoot) this.addRoot(element.shadowRoot);
    if (['video', 'canvas', 'img', 'iframe'].includes(element.localName)) {
      if (this.media.length < 24) {
        this.media.push(element);
        if (element instanceof HTMLVideoElement) this.watchVideo(element);
      } else this.limitations.add('TIMELINE_MEDIA_LIMIT_REACHED');
    }
  }

  protected watchVideo(video: HTMLVideoElement) {
    if (
      this.videoCallbacks.has(video) ||
      this.videoCallbacks.size >= 24 ||
      typeof video.requestVideoFrameCallback !== 'function'
    )
      return;
    const callback: VideoFrameRequestCallback = (now, metadata) => {
      if (this.stopped || !video.isConnected) {
        this.videoCallbacks.delete(video);
        return;
      }
      const values = [
        now,
        metadata.presentationTime,
        metadata.expectedDisplayTime,
        metadata.mediaTime,
        metadata.presentedFrames,
      ];
      if (
        values.every((value) => Number.isFinite(value) && value >= 0) &&
        Number.isInteger(metadata.presentedFrames)
      )
        this.videoPresentations.set(video, {
          callbackEpochMs: performance.timeOrigin + now,
          presentationEpochMs:
            performance.timeOrigin + metadata.presentationTime,
          expectedDisplayEpochMs:
            performance.timeOrigin + metadata.expectedDisplayTime,
          mediaTimeMs: metadata.mediaTime * 1000,
          presentedFrames: metadata.presentedFrames,
        });
      this.videoCallbacks.set(video, video.requestVideoFrameCallback(callback));
    };
    this.videoCallbacks.set(video, video.requestVideoFrameCallback(callback));
  }

  protected discoverTargets(deadline: number): void {
    if (epoch() - this.lastTargetDiscovery < 100) return;
    const discovered = new Set<Element>();
    for (const root of this.roots) {
      if (performance.now() > deadline) {
        this.limitations.add('TIMELINE_TARGET_DISCOVERY_WORK_TRUNCATED');
        break;
      }
      const animations = root.getAnimations();
      if (animations.length > 64)
        this.limitations.add('TIMELINE_ANIMATION_LIMIT_REACHED');
      for (const animation of animations.slice(0, 64))
        if (
          animation.effect instanceof KeyframeEffect &&
          animation.effect.target instanceof Element
        )
          discovered.add(animation.effect.target);
    }
    // Sparse spatial coverage supplements animated/media/mutated targets.
    for (let x = 0; x < 6; x++)
      for (let y = 0; y < 4; y++) {
        const px = ((x + 0.5) / 6) * innerWidth,
          py = ((y + 0.5) / 4) * innerHeight;
        let element = document.elementFromPoint(px, py);
        for (let depth = 0; element?.shadowRoot && depth < 8; depth++) {
          this.addRoot(element.shadowRoot);
          const nested = element.shadowRoot.elementFromPoint(px, py);
          if (!nested || nested === element) break;
          element = nested;
        }
        if (element) discovered.add(element);
      }
    this.discoveredTargets = [...discovered].slice(0, 96);
    this.lastTargetDiscovery = epoch();
  }
  abstract sample(
    trigger?: 'INITIAL' | 'ANIMATION_FRAME' | 'TIMER_FALLBACK' | 'EVENT',
    renderEpochMs?: number,
  ): void;
  abstract stop(): Record<string, import('@epi-less/core').SourceTimeline>;
}
