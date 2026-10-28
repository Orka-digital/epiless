import {
  measuredMediaInterval,
  presentedSequence,
} from './media-replay-interval';
import { type MediaReplayPlan } from './media-replay-types';
import {
  replayableMediaState,
  validMediaEvidence,
} from './media-replay-validation';

/**
 * Construct a replay plan only from complete, reproducible media evidence.
 * @param value - Untrusted saved or content-script evidence.
 * @returns A bounded plan or explicit UNSUPPORTED reasons; never inferred playback coverage.
 */
export function mediaPlanFromEvidence(value: unknown): MediaReplayPlan {
  if (!validMediaEvidence(value))
    return {
      version: 1,
      status: 'UNSUPPORTED',
      reasons: ['MEDIA_EVIDENCE_UNAVAILABLE'],
      items: [],
    };
  const reasons = [...value.reasons];
  if (!value.complete)
    reasons.push('MEDIA_DISCOVERY_OR_OBSERVATION_INCOMPLETE');
  if (value.items.some((item) => !replayableMediaState(item.before)))
    reasons.push('MEDIA_NOT_SEEKABLE_FILE');
  if (value.items.some((item) => !presentedSequence(item)))
    reasons.push('MEDIA_PRESENTATION_COVERAGE_UNPROVEN');
  if (value.items.some((item) => !measuredMediaInterval(item)))
    reasons.push('MEDIA_INTERVAL_NOT_REPRODUCIBLE');
  return {
    version: 1,
    status: reasons.length ? 'UNSUPPORTED' : 'REPLAYABLE',
    reasons: [...new Set(reasons)].slice(0, 32),
    items: structuredClone(value.items.map((item) => item.before)),
    ...(reasons.length
      ? {}
      : {
          coverage: value.items.map((item) => {
            const interval = measuredMediaInterval(item)!;
            return {
              endMs: interval.endMs,
              wraps: interval.wraps,
              ...(interval.presentedEndMs === undefined
                ? {}
                : {
                    presentedEndMs: interval.presentedEndMs,
                    presentedWraps: interval.presentedWraps,
                  }),
            };
          }),
        }),
  };
}

/**
 * Project the replay contract into stable key material, including reached endpoints.
 * @param plan - Validated replay plan.
 * @returns Ordered fields consumed by the scenario identity hash.
 */
export function mediaPlanKey(plan: MediaReplayPlan): unknown[] {
  return [
    plan.version,
    plan.status,
    plan.reasons,
    plan.items.map((item) => [
      item.selectorPath,
      item.sourceKind,
      item.locatorSha256 ?? null,
      item.durationMs,
      item.timeMs,
      item.playbackRate,
      item.loop,
      item.paused,
    ]),
    ...(plan.coverage
      ? [
          plan.coverage.map((item) => [
            item.endMs,
            item.wraps,
            item.presentedEndMs ?? null,
            item.presentedWraps ?? null,
          ]),
        ]
      : []),
  ];
}
