import type { SourceTimeline, TimelineAnimation } from '@epi-less/core';
import type { DiagnosticContext } from './source-diagnostics';

export interface SourceTimelineEvent {
  generation: string;
  segmentId: string;
  findingId: string;
  windowStartMs: number;
  windowEndMs: number;
  windowStartEpochMs: number;
  windowEndEpochMs: number;
  clockBasis: 'FRAME_RECEIPT_ESTIMATE';
  alignmentUncertaintyMs: number | null;
  frameClock?: SourceTimeline['frameClock'];
  analysis: { width: number; height: number };
  source: { width: number; height: number };
  region: { x: number; y: number; width: number; height: number };
}

type Rectangle = SourceTimelineEvent['region'];
export interface TimelineTargetSample {
  id: string;
  inspectionToken?: string;
  selectorPath: string[];
  tag: string;
  media?: 'VIDEO' | 'CANVAS' | 'IMAGE' | 'IFRAME';
  rect: Rectangle;
  mutationsSincePrevious: number;
  animations: TimelineAnimation[];
  mediaTimeMs?: number;
  mediaPaused?: boolean;
  readWindow?: SourceTimeline['candidates'][number]['observations'][number]['readWindow'];
  videoPresentation?: SourceTimeline['candidates'][number]['observations'][number]['videoPresentation'];
}
export interface TimelineSnapshot {
  atEpochMs: number;
  context: DiagnosticContext;
  targets: TimelineTargetSample[];
  limitations: string[];
}

export const SOURCE_TIMELINE_INTERVAL_MS = 1000 / 30;
const RING_MS = 3_000;
const MAX_SNAPSHOTS = 96;
const CONTEXT_MS = 150;
const MAX_GAP_MS = 250;
const BASE_LIMITATIONS = [
  'TEMPORAL_SPATIAL_CORRELATION_NOT_VERIFIED_CAUSE',
  'FRAME_EPOCH_ESTIMATED_FROM_RECEIPT_CAPTURE_LATENCY_UNKNOWN',
  'DOM_SAMPLED_SEPARATELY_FROM_CAPTURE_NOT_FRAME_ATOMIC',
  'SPARSE_TARGET_SAMPLING_MAY_MISS_SOURCES',
  'TARGET_INVENTORY_100_MS_KEYFRAME_PROPERTY_INVENTORY_500_MS',
  'CLOSED_SHADOW_ROOTS_IFRAME_CONTENTS_AND_PSEUDO_ELEMENTS_NOT_INSPECTED',
];

function validEvent(e: SourceTimelineEvent): boolean {
  if (
    !e ||
    e.clockBasis !== 'FRAME_RECEIPT_ESTIMATE' ||
    !e.findingId ||
    e.findingId.length > 128
  )
    return false;
  const numbers = [
    e.windowStartMs,
    e.windowEndMs,
    e.windowStartEpochMs,
    e.windowEndEpochMs,
    e.analysis?.width,
    e.analysis?.height,
    e.source?.width,
    e.source?.height,
    e.region?.x,
    e.region?.y,
    e.region?.width,
    e.region?.height,
  ];
  return (
    numbers.every((v) => Number.isFinite(v) && v >= 0) &&
    e.windowEndMs >= e.windowStartMs &&
    e.windowEndEpochMs >= e.windowStartEpochMs &&
    e.windowEndEpochMs - e.windowStartEpochMs <= 2_000 &&
    e.analysis.width > 0 &&
    e.analysis.height > 0 &&
    e.region.width > 0 &&
    e.region.height > 0 &&
    e.region.x + e.region.width <= e.analysis.width &&
    e.region.y + e.region.height <= e.analysis.height &&
    (e.alignmentUncertaintyMs === null ||
      (Number.isFinite(e.alignmentUncertaintyMs) &&
        e.alignmentUncertaintyMs >= 0))
  );
}
function intersection(a: Rectangle, b: Rectangle): number {
  return (
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  );
}
function mappedRegion(
  e: SourceTimelineEvent,
  context: DiagnosticContext,
): Rectangle | undefined {
  const v = context.viewport;
  if (
    v.width <= 0 ||
    v.height <= 0 ||
    v.width > 16384 ||
    v.height > 16384 ||
    v.dpr <= 0 ||
    v.dpr > 16 ||
    v.visualScale !== 1 ||
    v.visualOffsetLeft !== 0 ||
    v.visualOffsetTop !== 0
  )
    return;
  const scale = Math.min(
    e.analysis.width / v.width,
    e.analysis.height / v.height,
  );
  if (
    Math.abs(e.analysis.width - v.width * scale) > 1.01 ||
    Math.abs(e.analysis.height - v.height * scale) > 1.01
  )
    return;
  return {
    x: (e.region.x / e.analysis.width) * v.width,
    y: (e.region.y / e.analysis.height) * v.height,
    width: (e.region.width / e.analysis.width) * v.width,
    height: (e.region.height / e.analysis.height) * v.height,
  };
}

/** Pure bounded temporal join; tests can exercise clocks and changing geometry without rendering flashes. */
export class SourceTimelineBuffer {
  private ring: TimelineSnapshot[] = [];
  private events = new Map<
    string,
    { event: SourceTimelineEvent; snapshots: TimelineSnapshot[] }
  >();
  constructor(
    readonly generation: string,
    readonly segmentId: string,
    private initial: DiagnosticContext,
  ) {}

  add(snapshot: TimelineSnapshot): void {
    if (
      !Number.isFinite(snapshot.atEpochMs) ||
      snapshot.atEpochMs < 0 ||
      (this.ring.length && snapshot.atEpochMs <= this.ring.at(-1)!.atEpochMs)
    )
      return;
    this.ring.push(snapshot);
    this.ring = this.ring
      .filter((s) => s.atEpochMs >= snapshot.atEpochMs - RING_MS)
      .slice(-MAX_SNAPSHOTS);
    for (const { event, snapshots } of this.events.values()) {
      if (
        snapshot.atEpochMs >= event.windowStartEpochMs - CONTEXT_MS &&
        snapshot.atEpochMs <= event.windowEndEpochMs + CONTEXT_MS &&
        snapshots.length < MAX_SNAPSHOTS
      )
        snapshots.push(snapshot);
    }
  }

  record(event: SourceTimelineEvent): boolean {
    if (
      !validEvent(event) ||
      event.generation !== this.generation ||
      event.segmentId !== this.segmentId ||
      this.events.has(event.findingId) ||
      this.events.size >= 8
    )
      return false;
    this.events.set(event.findingId, {
      event,
      snapshots: this.ring.filter(
        (s) =>
          s.atEpochMs >= event.windowStartEpochMs - CONTEXT_MS &&
          s.atEpochMs <= event.windowEndEpochMs + CONTEXT_MS,
      ),
    });
    return true;
  }

  finish(sampledAt: string): Record<string, SourceTimeline> {
    return Object.fromEntries(
      [...this.events].map(([id, value]) => [
        id,
        this.join(value.event, value.snapshots, sampledAt),
      ]),
    );
  }

  private join(
    event: SourceTimelineEvent,
    samples: TimelineSnapshot[],
    sampledAt: string,
  ): SourceTimeline {
    const limitations = new Set(BASE_LIMITATIONS);
    const result: SourceTimeline = {
      version: 1,
      status: 'UNAVAILABLE',
      clockBasis: event.clockBasis,
      windowStartEpochMs: event.windowStartEpochMs,
      windowEndEpochMs: event.windowEndEpochMs,
      alignmentUncertaintyMs: event.alignmentUncertaintyMs,
      ...(event.frameClock ? { frameClock: { ...event.frameClock } } : {}),
      sampledAt,
      sampleIntervalMs: SOURCE_TIMELINE_INTERVAL_MS,
      maxSampleGapMs: 0,
      complete: false,
      sampleCount: samples.length,
      ...(samples.length
        ? {
            firstSampleEpochMs: samples[0]!.atEpochMs,
            lastSampleEpochMs: samples.at(-1)!.atEpochMs,
          }
        : {}),
      candidates: [],
      limitations: [],
    };
    const candidates = new Map<
      string,
      {
        candidate: SourceTimeline['candidates'][number];
        score: number;
        observedInWindow: boolean;
      }
    >();
    let usable = 0;
    for (const [i, snapshot] of samples.entries()) {
      if (i)
        result.maxSampleGapMs = Math.max(
          result.maxSampleGapMs,
          snapshot.atEpochMs - samples[i - 1]!.atEpochMs,
        );
      for (const limitation of snapshot.limitations)
        limitations.add(limitation);
      if (
        snapshot.context.documentToken !== this.initial.documentToken ||
        snapshot.context.url !== this.initial.url
      ) {
        limitations.add('DOCUMENT_OR_ROUTE_CHANGED_DURING_WINDOW');
        continue;
      }
      if (snapshot.context.viewportRevision !== this.initial.viewportRevision) {
        // Resize/pinch can return to the original geometry between samples.
        // Its monotonic revision still makes the intervening mapping uncertain.
        limitations.add('VIEWPORT_CONTEXT_REVISION_CHANGED_DURING_WINDOW');
        continue;
      }
      if (
        snapshot.context.viewport.width !== this.initial.viewport.width ||
        snapshot.context.viewport.height !== this.initial.viewport.height ||
        snapshot.context.viewport.dpr !== this.initial.viewport.dpr
      ) {
        limitations.add('VIEWPORT_SIZE_OR_DPR_CHANGED_DURING_WINDOW');
        continue;
      }
      const region = mappedRegion(event, snapshot.context);
      if (!region) {
        limitations.add('TIMELINE_VIEWPORT_GEOMETRY_UNSUPPORTED');
        continue;
      }
      usable++;
      const viewport = snapshot.context.viewport;
      for (const target of snapshot.targets) {
        const overlap = intersection(region, target.rect);
        if (overlap <= 0) continue;
        let entry = candidates.get(target.id);
        if (!entry) {
          entry = {
            score: 0,
            observedInWindow: false,
            candidate: {
              id: target.id,
              ...(target.inspectionToken
                ? { inspectionToken: target.inspectionToken }
                : {}),
              selectorPath: [...target.selectorPath],
              tag: target.tag,
              ...(target.media ? { media: target.media } : {}),
              observations: [],
            },
          };
          candidates.set(target.id, entry);
        }
        const readStart = target.readWindow?.startEpochMs ?? snapshot.atEpochMs;
        const readEnd = target.readWindow?.endEpochMs ?? snapshot.atEpochMs;
        if (
          readEnd >= event.windowStartEpochMs &&
          readStart <= event.windowEndEpochMs
        ) {
          // The ±150 ms margin supplies context for an actually observed
          // candidate. A replacement that appears only afterwards is not a
          // source during the estimated detecting window, however well sampled.
          entry.observedInWindow = true;
          entry.score +=
            ((target.animations.some((a) => a.playState === 'running') ||
            target.media ||
            target.mutationsSincePrevious
              ? 2
              : 1) *
              overlap) /
            Math.max(1, target.rect.width * target.rect.height);
        }
        entry.candidate.observations.push({
          atEpochMs: snapshot.atEpochMs,
          ...(target.readWindow
            ? { readWindow: { ...target.readWindow } }
            : {}),
          rect: { ...target.rect },
          viewport: {
            width: viewport.width,
            height: viewport.height,
            dpr: viewport.dpr,
            scrollX: viewport.scrollX,
            scrollY: viewport.scrollY,
          },
          mutationsSincePrevious: target.mutationsSincePrevious,
          animations: target.animations.map((a) => ({
            ...a,
            properties: [...a.properties],
          })),
          ...(target.mediaTimeMs !== undefined
            ? { mediaTimeMs: target.mediaTimeMs }
            : {}),
          ...(target.mediaPaused !== undefined
            ? { mediaPaused: target.mediaPaused }
            : {}),
          ...(target.videoPresentation
            ? { videoPresentation: { ...target.videoPresentation } }
            : {}),
        });
      }
    }
    const observedCandidates = [...candidates.values()].filter(
      (entry) => entry.observedInWindow,
    );
    if (observedCandidates.length > 6)
      limitations.add('TIMELINE_CANDIDATE_LIMIT_REACHED');
    result.candidates = observedCandidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((entry) => entry.candidate);
    result.status = result.candidates.length ? 'CORRELATED' : 'UNAVAILABLE';
    const startCovered =
      samples.length > 0 && samples[0]!.atEpochMs <= event.windowStartEpochMs;
    const endCovered =
      samples.length > 0 && samples.at(-1)!.atEpochMs >= event.windowEndEpochMs;
    if (!startCovered || !endCovered)
      limitations.add('DETECTION_WINDOW_NOT_FULLY_SAMPLED');
    if (result.maxSampleGapMs > MAX_GAP_MS)
      limitations.add('DOM_TIMELINE_SAMPLE_GAP');
    result.complete =
      result.status === 'CORRELATED' &&
      startCovered &&
      endCovered &&
      usable === samples.length &&
      result.maxSampleGapMs <= MAX_GAP_MS &&
      ![...limitations].some((l) => /LIMIT_REACHED|TRUNCATED/.test(l));
    if (result.status === 'UNAVAILABLE')
      result.reason = !samples.length
        ? 'NO_SAMPLES_NEAR_DETECTING_WINDOW'
        : candidates.size
          ? 'OVERLAPPING_TARGETS_ONLY_OUTSIDE_DETECTING_WINDOW'
          : 'NO_OVERLAPPING_SAMPLED_TARGET';
    result.limitations = [...limitations].slice(0, 16);
    return result;
  }
}
