import type { SourceTimeline } from '@epi-less/core';

import {
  type Rectangle,
  type SourceTimelineEvent,
  type TimelineSnapshot,
  intersection,
} from './timeline-event';

type TimelineCandidates = Map<
  string,
  {
    candidate: SourceTimeline['candidates'][number];
    score: number;
    observedInWindow: boolean;
  }
>;

/** Accumulate overlapping targets and their observed windows; retain correlation without asserting source causality. */
export function accumulateTimelineTargets(
  event: SourceTimelineEvent,
  snapshot: TimelineSnapshot,
  region: Rectangle,
  candidates: TimelineCandidates,
): void {
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
      ...(target.readWindow ? { readWindow: { ...target.readWindow } } : {}),
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
