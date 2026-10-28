import { type SourceTimelineEvent } from './source-timeline-core';
import { TimelineSession } from './timeline-session';

export type { SourceTimelineEvent } from './source-timeline-core';
export { inspectSourceTimelineTarget } from './timeline-inspection';

let active: TimelineSession | undefined;

/** Start a bounded source timeline for one generation and segment, replacing any prior session. */
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

/** Join an event only to the currently owned timeline generation and segment. */
export function recordSourceTimelineEvent(event: SourceTimelineEvent) {
  return {
    recorded:
      active?.generation === event?.generation &&
      active?.segmentId === event?.segmentId
        ? active.record(event)
        : false,
  };
}

/** Finish the matching timeline and release its sampling resources. */
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

/** Stop active timeline sampling without returning evidence from another session. */
export function cancelSourceTimeline() {
  active?.stop();
  active = undefined;
}
