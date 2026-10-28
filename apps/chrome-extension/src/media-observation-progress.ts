import { observedLoopSeeks } from './media-loop-seek';
import type { MediaObservation } from './media-observation';
import {
  measuredMediaInterval,
  MEDIA_POSITION_EPSILON_MS,
  type MediaReplayPlan,
} from './media-replay';
/** Require observed media intervals and compositor wraps to cover every planned item. */
export function mediaObservationProgress(
  entries: MediaObservation['entries'],
  reasons: Set<string>,
  plan: MediaReplayPlan,
) {
  const intervals = entries.map((entry) =>
    measuredMediaInterval({
      before: entry.before,
      after: entry.before,
      samples: entry.samples,
      presentations: entry.presentations,
    }),
  );
  return {
    covered:
      reasons.size === 0 &&
      entries.every((entry) =>
        observedLoopSeeks(
          {
            before: entry.before,
            after: entry.before,
            samples: entry.samples,
            presentations: entry.presentations,
          },
          entry.seeks,
        ),
      ) &&
      Boolean(plan.coverage) &&
      plan.coverage!.length === intervals.length &&
      intervals.every(
        (interval, index) =>
          interval &&
          interval.endMs >=
            plan.coverage![index].endMs - MEDIA_POSITION_EPSILON_MS &&
          interval.wraps >= plan.coverage![index].wraps &&
          (plan.coverage![index].presentedEndMs === undefined ||
            (interval.presentedEndMs !== undefined &&
              interval.presentedEndMs >=
                plan.coverage![index].presentedEndMs -
                  MEDIA_POSITION_EPSILON_MS &&
              interval.presentedWraps >=
                (plan.coverage![index].presentedWraps ?? 0))),
      ),
  };
}
