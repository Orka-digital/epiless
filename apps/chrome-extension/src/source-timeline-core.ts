import type { SourceTimeline } from '@epi-less/core';

import type { DiagnosticContext } from './source-diagnostics';
import {
  type SourceTimelineEvent,
  type TimelineSnapshot,
  CONTEXT_MS,
  MAX_SNAPSHOTS,
  RING_MS,
  validEvent,
} from './timeline-event';
import { joinTimeline } from './timeline-join';

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
        joinTimeline(this.initial, value.event, value.snapshots, sampledAt),
      ]),
    );
  }
}
export { SOURCE_TIMELINE_INTERVAL_MS } from './timeline-event';
export type {
  SourceTimelineEvent,
  TimelineSnapshot,
  TimelineTargetSample,
} from './timeline-event';
