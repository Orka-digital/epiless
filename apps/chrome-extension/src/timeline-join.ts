import type { SourceTimeline } from '@epi-less/core';

import type { DiagnosticContext } from './source-diagnostics';
import {
  type SourceTimelineEvent,
  type TimelineSnapshot,
  BASE_LIMITATIONS,
  mappedRegion,
  MAX_GAP_MS,
  SOURCE_TIMELINE_INTERVAL_MS,
} from './timeline-event';
import { accumulateTimelineTargets } from './timeline-target-join';

/** Correlate retained snapshots with one detecting window and report missing coverage explicitly. */
export function joinTimeline(
  initial: DiagnosticContext,
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
          firstSampleEpochMs: samples[0].atEpochMs,
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
        snapshot.atEpochMs - samples[i - 1].atEpochMs,
      );
    for (const limitation of snapshot.limitations) limitations.add(limitation);
    const contextFailure = timelineContextFailure(snapshot.context, initial);
    if (contextFailure) {
      limitations.add(contextFailure);
      continue;
    }
    const region = mappedRegion(event, snapshot.context);
    if (!region) {
      limitations.add('TIMELINE_VIEWPORT_GEOMETRY_UNSUPPORTED');
      continue;
    }
    usable++;
    accumulateTimelineTargets(event, snapshot, region, candidates);
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
  applyTimelineCoverage(result, samples, event, usable, limitations);
  if (result.status === 'UNAVAILABLE')
    result.reason = !samples.length
      ? 'NO_SAMPLES_NEAR_DETECTING_WINDOW'
      : candidates.size
        ? 'OVERLAPPING_TARGETS_ONLY_OUTSIDE_DETECTING_WINDOW'
        : 'NO_OVERLAPPING_SAMPLED_TARGET';
  result.limitations = [...limitations].slice(0, 16);
  return result;
}

function timelineContextFailure(
  current: DiagnosticContext,
  initial: DiagnosticContext,
): string | undefined {
  if (
    current.documentToken !== initial.documentToken ||
    current.url !== initial.url
  ) {
    return 'DOCUMENT_OR_ROUTE_CHANGED_DURING_WINDOW';
  }
  if (current.viewportRevision !== initial.viewportRevision) {
    // Resize/pinch can return to the original geometry between samples.
    // Its monotonic revision still makes the intervening mapping uncertain.
    return 'VIEWPORT_CONTEXT_REVISION_CHANGED_DURING_WINDOW';
  }
  if (
    current.viewport.width !== initial.viewport.width ||
    current.viewport.height !== initial.viewport.height ||
    current.viewport.dpr !== initial.viewport.dpr
  ) {
    return 'VIEWPORT_SIZE_OR_DPR_CHANGED_DURING_WINDOW';
  }
}

function applyTimelineCoverage(
  result: SourceTimeline,
  samples: TimelineSnapshot[],
  event: SourceTimelineEvent,
  usable: number,
  limitations: Set<string>,
): void {
  const startCovered =
    samples.length > 0 && samples[0].atEpochMs <= event.windowStartEpochMs;
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
}
