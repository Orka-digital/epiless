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

export type Rectangle = SourceTimelineEvent['region'];

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

export const RING_MS = 3_000;

export const MAX_SNAPSHOTS = 96;

export const CONTEXT_MS = 150;

export const MAX_GAP_MS = 250;

export const BASE_LIMITATIONS = [
  'TEMPORAL_SPATIAL_CORRELATION_NOT_VERIFIED_CAUSE',
  'FRAME_EPOCH_ESTIMATED_FROM_RECEIPT_CAPTURE_LATENCY_UNKNOWN',
  'DOM_SAMPLED_SEPARATELY_FROM_CAPTURE_NOT_FRAME_ATOMIC',
  'SPARSE_TARGET_SAMPLING_MAY_MISS_SOURCES',
  'TARGET_INVENTORY_100_MS_KEYFRAME_PROPERTY_INVENTORY_500_MS',
  'CLOSED_SHADOW_ROOTS_IFRAME_CONTENTS_AND_PSEUDO_ELEMENTS_NOT_INSPECTED',
];

/** Reject malformed event clocks and out-of-bounds regions before timeline correlation. */
export function validEvent(e: SourceTimelineEvent): boolean {
  if (
    !e ||
    e.clockBasis !== 'FRAME_RECEIPT_ESTIMATE' ||
    !e.findingId ||
    e.findingId.length > 128
  )
    return false;
  return (
    finiteEventCoordinates(e) &&
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

/** Return the nonnegative intersection area of two axis-aligned rectangles. */
export function intersection(a: Rectangle, b: Rectangle): number {
  return (
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  );
}

/** Map an analysis rectangle into supported CSS geometry; return undefined for ambiguous viewport transforms. */
export function mappedRegion(
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

function finiteEventCoordinates(e: SourceTimelineEvent): boolean {
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
  return numbers.every((v) => Number.isFinite(v) && v >= 0);
}
