import {
  diagnosticContext,
  resolveDiagnosticPath,
  structuralDiagnosticPath,
  type DiagnosticContext,
} from './source-diagnostics';

import {
  type SourceTimelineEvent,
  type TimelineTargetSample,
} from './source-timeline-core';
import { TimelineDiscovery } from './timeline-discovery';
import { inspectable } from './timeline-inspection';
import {
  animationDetails,
  epoch,
  identities,
  nativeTags,
} from './timeline-observation';

/** Join bounded DOM samples to source events while retaining geometry, clock and sampling limitations. */
export class TimelineSession extends TimelineDiscovery {
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
    this.discoverTargets(deadline);
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
      const sample = this.sampleTarget(
        element,
        context,
        trigger,
        renderEpochMs,
      );
      if (sample) samples.push(sample);
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

  private sampleTarget(
    element: Element,
    context: DiagnosticContext,
    trigger: NonNullable<TimelineTargetSample['readWindow']>['trigger'],
    renderEpochMs: number | undefined,
  ): TimelineTargetSample | undefined {
    if (!element.isConnected) return undefined;
    const readStartEpochMs = epoch();
    const rect = element.getBoundingClientRect();
    if (!visibleTimelineRectangle(rect)) return undefined;
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
      return undefined;
    }
    this.paths.set(element, {
      revision: this.structureRevision,
      path: selectorPath,
    });
    const id = timelineIdentity(element);
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
    const media = timelineMediaKind(tag);
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
    return sample;
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

function visibleTimelineRectangle(rect: DOMRect): boolean {
  return !(
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.right <= 0 ||
    rect.bottom <= 0 ||
    rect.x >= innerWidth ||
    rect.y >= innerHeight ||
    ![rect.x, rect.y, rect.width, rect.height].every(
      (v) => Number.isFinite(v) && Math.abs(v) <= 1_000_000,
    )
  );
}

function timelineMediaKind(tag: string): TimelineTargetSample['media'] {
  return tag === 'video'
    ? 'VIDEO'
    : tag === 'canvas'
      ? 'CANVAS'
      : tag === 'img'
        ? 'IMAGE'
        : tag === 'iframe'
          ? 'IFRAME'
          : undefined;
}

function timelineIdentity(element: Element): string {
  let id = identities.get(element);
  if (!id) {
    id = crypto.randomUUID();
    identities.set(element, id);
  }
  return id;
}
