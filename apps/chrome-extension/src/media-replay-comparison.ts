import type { Finding } from '@epi-less/core';
import {
  measuredMediaInterval,
  presentedSequence,
} from './media-replay-interval';
import { MEDIA_POSITION_EPSILON_MS } from './media-replay-types';
import {
  sameSource,
  validMediaEvidence,
  validMediaPlan,
} from './media-replay-validation';
import type { Observation } from './model';

/**
 * Detect media clues in evidence, replay steps or findings, including legacy records.
 */
export function hasMediaContext(observation: Observation): boolean {
  return Boolean(
    observation.mediaEvidence?.items.length ||
    observation.replay?.mediaPlan?.items.length ||
    observation.replay?.steps.some(
      (step) => 'target' in step && step.target.kind === 'media',
    ) ||
    observation.measurement?.findings.some(
      (finding) =>
        finding.source?.candidates.some(
          (candidate) => candidate.media === 'VIDEO',
        ) ||
        finding.sourceTimeline?.candidates.some(
          (candidate) => candidate.media === 'VIDEO',
        ),
    ),
  );
}

/**
 * Explain why a replay does not prove the originally observed media interval.
 *
 * Every original compositor timestamp must recur in order. Advancing currentTime,
 * matching URLs or extra endpoint coverage cannot replace missing presentations.
 * @param baseline - Original observation with its saved media plan.
 * @param repeated - New observation collected during the targeted replay.
 * @param finding - Optional candidate whose source-clock interval must be covered.
 * @returns Blocking reasons, or an empty array when this media-specific comparison passes.
 * This is not a full capture-quality, source-causality or WCAG verdict.
 */
export function mediaComparisonReasons(
  baseline: Observation,
  repeated: Observation,
  finding?: Finding,
): string[] {
  const before = baseline.mediaEvidence,
    after = repeated.mediaEvidence;
  const plan = baseline.replay?.mediaPlan;
  const known = hasMediaContext(baseline) || hasMediaContext(repeated);
  // Legacy DOM-only observations retain their old compatibility. Known media never does.
  if (legacyMediaCompatible(known, before, after, plan)) return [];
  if (
    !validMediaPlan(plan) ||
    plan.status !== 'REPLAYABLE' ||
    !validMediaEvidence(before) ||
    !before.complete ||
    !validMediaEvidence(after) ||
    !after.complete
  )
    return [
      'De media-identiteit, seekbare beginstand of volledige mediabeweging is niet bewezen.',
    ];
  if (
    known &&
    (before.items.length === 0 ||
      after.items.length === 0 ||
      plan.items.length === 0)
  )
    return [
      'Een videokandidaat heeft geen geregistreerde media-identiteit of presentatiebewijs.',
    ];
  const clockReason =
    known && finding ? mediaClockReason(finding, before) : undefined;
  if (clockReason) return [clockReason];
  if (
    before.items.length !== after.items.length ||
    before.items.length !== plan.items.length
  )
    return ['De aanwezige media verschillen tussen de metingen.'];
  return compareMediaItems(before, after, plan);
}

function legacyMediaCompatible(
  known: boolean,
  before: Observation['mediaEvidence'],
  after: Observation['mediaEvidence'],
  plan: NonNullable<Observation['replay']>['mediaPlan'],
): boolean {
  return (
    !known &&
    (!before ||
      (validMediaEvidence(before) &&
        before.complete &&
        before.items.length === 0)) &&
    (!after ||
      (validMediaEvidence(after) &&
        after.complete &&
        after.items.length === 0)) &&
    (!plan ||
      (validMediaPlan(plan) &&
        plan.status === 'REPLAYABLE' &&
        plan.items.length === 0))
  );
}

function compareMediaItems(
  before: import('./media-replay-types').MediaEvidence,
  after: import('./media-replay-types').MediaEvidence,
  plan: import('./media-replay-types').MediaReplayPlan,
): string[] {
  for (let index = 0; index < before.items.length; index++) {
    const original = before.items[index],
      next = after.items[index],
      expected = plan.items[index];
    const originalInterval = measuredMediaInterval(original),
      nextInterval = measuredMediaInterval(next);
    const originalFrames = presentedSequence(original)?.points,
      nextFrames = presentedSequence(next)?.points;
    // Every originally observed PTS must actually recur, in order. Extra leading
    // or trailing presentations are permitted; a missing middle frame is not.
    let frameCursor = 0;
    const presentedSame =
      originalFrames &&
      nextFrames &&
      originalFrames.every((point) => {
        while (
          frameCursor < nextFrames.length &&
          nextFrames[frameCursor] < point - MEDIA_POSITION_EPSILON_MS
        )
          frameCursor++;
        return (
          frameCursor < nextFrames.length &&
          Math.abs(nextFrames[frameCursor++] - point) <=
            MEDIA_POSITION_EPSILON_MS
        );
      });
    if (
      !sameSource(expected, original.before) ||
      !sameSource(original.before, next.before) ||
      !originalInterval ||
      !nextInterval ||
      !presentedSame ||
      Math.abs(expected.timeMs - original.before.timeMs) >
        MEDIA_POSITION_EPSILON_MS ||
      Math.abs(original.before.timeMs - next.before.timeMs) >
        MEDIA_POSITION_EPSILON_MS ||
      nextInterval.startMs >
        originalInterval.startMs + MEDIA_POSITION_EPSILON_MS ||
      nextInterval.endMs < originalInterval.endMs - MEDIA_POSITION_EPSILON_MS ||
      nextInterval.wraps < originalInterval.wraps
    )
      return [
        'De hercontrole bewijst niet hetzelfde bronlocator-, afspeel- en daadwerkelijk bereikte videointerval.',
      ];
  }
  return [];
}

function mediaClockReason(
  finding: Finding,
  before: NonNullable<Observation['mediaEvidence']>,
): string | undefined {
  const clock = finding.sourceTimeline;
  if (
    !clock?.frameClock ||
    clock.windowStartEpochMs - clock.frameClock.startBoundaryErrorMs <
      before.startedEpochMs! ||
    clock.windowEndEpochMs + clock.frameClock.endBoundaryErrorMs >
      before.endedEpochMs!
  )
    return 'Het oorspronkelijke mediasignaal ligt niet aantoonbaar binnen het geregistreerde clipinterval; de bronklok blijft een ontvangstschatting.';
}
