import type { TimelineAnimation } from '@epi-less/core';
import {
  diagnosticContext,
  resolveDiagnosticPath,
  structuralDiagnosticPath,
  type DiagnosticContext,
} from './source-diagnostics';
import {
  SourceTimelineBuffer,
  SOURCE_TIMELINE_INTERVAL_MS,
  type SourceTimelineEvent,
  type TimelineTargetSample,
} from './source-timeline-core';

export type { SourceTimelineEvent } from './source-timeline-core';
const epoch = () => performance.timeOrigin + performance.now();
const nativeTags = new Set(
  'a article aside audio body button canvas details dialog div em fieldset figure figcaption footer form h1 h2 h3 h4 h5 h6 header hr html iframe img input label li main nav ol p picture section select small span strong summary svg table tbody td textarea th thead tr ul video'.split(
    ' ',
  ),
);
const safeProperties = new Set([
  'opacity',
  'backgroundColor',
  'color',
  'fill',
  'stroke',
  'filter',
  'transform',
  'visibility',
  'clipPath',
]);
const identities = new WeakMap<Element, string>();
const keyframeProperties = new WeakMap<
  KeyframeEffect,
  { at: number; values: TimelineAnimation['properties'] }
>();
const inspectable = new Map<
  string,
  { element: WeakRef<Element>; context: DiagnosticContext; expiresAt: number }
>();
let active: TimelineSession | undefined;

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function animationDetails(element: Element): TimelineAnimation[] {
  return element
    .getAnimations()
    .slice(0, 4)
    .map((animation) => {
      const effect = animation.effect;
      const timing = effect?.getComputedTiming();
      const properties = new Set<TimelineAnimation['properties'][number]>();
      // Only property categories are retained. No keyframe values, names, text or URLs.
      if (effect instanceof KeyframeEffect) {
        const cached = keyframeProperties.get(effect);
        if (cached && performance.now() - cached.at < 500)
          for (const property of cached.values) properties.add(property);
        else {
          for (const frame of effect.getKeyframes().slice(0, 32))
            for (const name of Object.keys(frame).slice(0, 32)) {
              if (
                ['offset', 'computedOffset', 'easing', 'composite'].includes(
                  name,
                )
              )
                continue;
              properties.add(
                safeProperties.has(name)
                  ? (name as TimelineAnimation['properties'][number])
                  : 'other',
              );
            }
          keyframeProperties.set(effect, {
            at: performance.now(),
            values: [...properties].slice(0, 10),
          });
        }
      }
      return {
        kind:
          typeof CSSAnimation !== 'undefined' &&
          animation instanceof CSSAnimation
            ? 'CSS_ANIMATION'
            : typeof CSSTransition !== 'undefined' &&
                animation instanceof CSSTransition
              ? 'CSS_TRANSITION'
              : 'WEB_ANIMATION',
        playState: animation.playState,
        durationMs: finite(timing?.duration),
        delayMs: finite(timing?.delay) ?? 0,
        iterations: finite(timing?.iterations),
        currentTimeMs: finite(animation.currentTime),
        progress: finite(timing?.progress),
        properties: [...properties].slice(0, 10),
      };
    });
}

class TimelineSession {
  readonly buffer: SourceTimelineBuffer;
  private timer: ReturnType<typeof setInterval>;
  private animationFrame = 0;
  private stopped = false;
  private lastSampleAt = -Infinity;
  private lastAnimationTick = -Infinity;
  private observer: MutationObserver;
  private roots = new Set<Document | ShadowRoot>();
  private changed = new Set<Element>();
  private counts = new WeakMap<Element, number>();
  private tokens = new WeakMap<Element, string>();
  private limitations = new Set<string>();
  private media: Element[] = [];
  private lastDiscovery = -Infinity;
  private lastTargetDiscovery = -Infinity;
  private discoveredTargets: Element[] = [];
  private structureRevision = 0;
  private paths = new WeakMap<Element, { revision: number; path: string[] }>();
  private videoCallbacks = new Map<HTMLVideoElement, number>();
  private videoPresentations = new WeakMap<
    HTMLVideoElement,
    NonNullable<TimelineTargetSample['videoPresentation']>
  >();
  private startedAt = epoch();
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
  private addRoot(root: Document | ShadowRoot) {
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
  private discover(deadline: number) {
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
        if (element.shadowRoot) this.addRoot(element.shadowRoot);
        if (['video', 'canvas', 'img', 'iframe'].includes(element.localName)) {
          if (this.media.length < 24) {
            this.media.push(element);
            if (element instanceof HTMLVideoElement) this.watchVideo(element);
          } else this.limitations.add('TIMELINE_MEDIA_LIMIT_REACHED');
        }
      }
    }
  }
  private watchVideo(video: HTMLVideoElement) {
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
  sample(
    trigger:
      'INITIAL' | 'ANIMATION_FRAME' | 'TIMER_FALLBACK' | 'EVENT' = 'EVENT',
    renderEpochMs?: number,
  ): void {
    if (this.stopped) return;
    // A lost stop message cannot leave a permanent page observer behind.
    if (epoch() - this.startedAt > 130_000) {
      this.stop();
      return;
    }
    const started = performance.now();
    this.lastSampleAt = started;
    const deadline = started + 6;
    const context = diagnosticContext();
    if (epoch() - this.lastDiscovery >= 500) {
      this.discover(deadline);
      this.lastDiscovery = epoch();
    }
    const targets = new Set<Element>(this.changed);
    if (epoch() - this.lastTargetDiscovery >= 100) {
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
    for (const media of this.media) targets.add(media);
    for (const target of this.discoveredTargets) targets.add(target);
    const samples: TimelineTargetSample[] = [];
    for (const element of targets) {
      if (samples.length >= 48) {
        this.limitations.add('TIMELINE_TARGET_LIMIT_REACHED');
        break;
      }
      if (performance.now() > deadline && samples.length) {
        this.limitations.add('TIMELINE_SAMPLE_WORK_TRUNCATED');
        break;
      }
      if (!element.isConnected) continue;
      const readStartEpochMs = epoch();
      const rect = element.getBoundingClientRect();
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.right <= 0 ||
        rect.bottom <= 0 ||
        rect.x >= innerWidth ||
        rect.y >= innerHeight ||
        ![rect.x, rect.y, rect.width, rect.height].every(
          (v) => Number.isFinite(v) && Math.abs(v) <= 1_000_000,
        )
      )
        continue;
      const cachedPath = this.paths.get(element);
      const selectorPath =
        cachedPath?.revision === this.structureRevision
          ? cachedPath.path
          : structuralDiagnosticPath(element);
      if (
        !selectorPath ||
        (cachedPath?.revision !== this.structureRevision &&
          resolveDiagnosticPath(selectorPath) !== element)
      ) {
        this.limitations.add('TIMELINE_SELECTOR_LIMIT_REACHED');
        continue;
      }
      this.paths.set(element, {
        revision: this.structureRevision,
        path: selectorPath,
      });
      let id = identities.get(element);
      if (!id) {
        id = crypto.randomUUID();
        identities.set(element, id);
      }
      let token = this.tokens.get(element);
      if (!token) {
        token = crypto.randomUUID();
        this.tokens.set(element, token);
        inspectable.set(token, {
          element: new WeakRef(element),
          context,
          expiresAt: epoch() + 10 * 60_000,
        });
      }
      if (inspectable.size > 256)
        inspectable.delete(inspectable.keys().next().value!);
      const tag = element.localName;
      const media =
        tag === 'video'
          ? 'VIDEO'
          : tag === 'canvas'
            ? 'CANVAS'
            : tag === 'img'
              ? 'IMAGE'
              : tag === 'iframe'
                ? 'IFRAME'
                : undefined;
      const sample: TimelineTargetSample = {
        id,
        inspectionToken: token,
        selectorPath,
        tag: nativeTags.has(tag) ? tag : 'custom-element',
        ...(media ? { media } : {}),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        mutationsSincePrevious: this.counts.get(element) ?? 0,
        animations: animationDetails(element),
        ...(element instanceof HTMLVideoElement &&
        Number.isFinite(element.currentTime) &&
        element.currentTime >= 0
          ? {
              mediaTimeMs: element.currentTime * 1000,
              mediaPaused: element.paused,
            }
          : {}),
        ...(element instanceof HTMLVideoElement &&
        this.videoPresentations.has(element)
          ? { videoPresentation: { ...this.videoPresentations.get(element)! } }
          : {}),
      };
      sample.readWindow = {
        startEpochMs: readStartEpochMs,
        endEpochMs: epoch(),
        trigger,
        ...(renderEpochMs !== undefined ? { renderEpochMs } : {}),
      };
      samples.push(sample);
    }
    const atEpochMs = epoch();
    // DOM inspection has finite duration; record completion time and retain its bound.
    if (performance.now() - started > 8)
      this.limitations.add('DOM_SNAPSHOT_TIME_LIMIT_REACHED');
    this.buffer.add({
      atEpochMs,
      context,
      targets: samples,
      limitations: [...this.limitations],
    });
    this.changed.clear();
    this.counts = new WeakMap();
  }
  record(event: SourceTimelineEvent): boolean {
    this.sample();
    return this.buffer.record(event);
  }
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    cancelAnimationFrame(this.animationFrame);
    for (const [video, callback] of this.videoCallbacks)
      video.cancelVideoFrameCallback(callback);
    this.videoCallbacks.clear();
    this.observer.disconnect();
    this.changed.clear();
    this.roots.clear();
    return this.buffer.finish(new Date().toISOString());
  }
}

export function startSourceTimeline(input: {
  generation: string;
  segmentId: string;
}) {
  cancelSourceTimeline();
  if (
    !input ||
    typeof input.generation !== 'string' ||
    typeof input.segmentId !== 'string' ||
    !input.generation ||
    !input.segmentId ||
    input.generation.length > 128 ||
    input.segmentId.length > 128
  )
    throw new Error('INVALID_SOURCE_TIMELINE_SESSION');
  active = new TimelineSession(input.generation, input.segmentId);
  return { started: true };
}
export function recordSourceTimelineEvent(event: SourceTimelineEvent) {
  return {
    recorded:
      active?.generation === event?.generation &&
      active?.segmentId === event?.segmentId
        ? active.record(event)
        : false,
  };
}
export function stopSourceTimeline(input: {
  generation: string;
  segmentId: string;
}) {
  if (
    !active ||
    active.generation !== input?.generation ||
    active.segmentId !== input?.segmentId
  )
    return {};
  const session = active;
  active = undefined;
  return session.stop();
}
export function cancelSourceTimeline() {
  active?.stop();
  active = undefined;
}

/** A stale path is never enough: retain original-node identity in this isolated content world. */
function inspectableElement(token: string): Element | undefined {
  const value = typeof token === 'string' ? inspectable.get(token) : undefined;
  const context = diagnosticContext();
  const element = value?.element.deref();
  if (
    !value ||
    !element ||
    !element.isConnected ||
    value.expiresAt < epoch() ||
    value.context.documentToken !== context.documentToken ||
    value.context.url !== context.url
  )
    return;
  const selectorPath = structuralDiagnosticPath(element);
  if (!selectorPath || resolveDiagnosticPath(selectorPath) !== element) return;
  return element;
}

/** DevTools can call inspect(this bridge(token)) with useContentScriptContext, without page-world script injection. */
if (!Object.hasOwn(globalThis, '__flashguardInspectSource'))
  Object.defineProperty(globalThis, '__flashguardInspectSource', {
    value: inspectableElement,
    enumerable: false,
    writable: false,
    configurable: false,
  });

export function inspectSourceTimelineTarget(token: string) {
  const element = inspectableElement(token);
  if (!element)
    return {
      status: 'UNAVAILABLE' as const,
      reason: 'SOURCE_TARGET_STALE_OR_DOCUMENT_CHANGED',
    };
  const selectorPath = structuralDiagnosticPath(element)!;
  const rect = element.getBoundingClientRect();
  return {
    status: 'AVAILABLE' as const,
    selectorPath,
    tag: nativeTags.has(element.localName)
      ? element.localName
      : 'custom-element',
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    documentToken: diagnosticContext().documentToken,
  };
}
