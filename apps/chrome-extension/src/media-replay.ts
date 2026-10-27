import type { Observation } from './model';
import type { Finding } from '@epi-less/core';

export const MEDIA_REPLAY_LIMIT = 8;
/** 50ms samples cover the existing 120s observation ceiling, with bounded teardown margin. */
export const MEDIA_SAMPLE_LIMIT = 2600;
export const MEDIA_SAMPLE_INTERVAL_MS = 50;
export const MEDIA_PRESENTATION_LIMIT = 7800;
/** Browser media clocks can be rounded; this is not capture/DOM alignment proof. */
export const MEDIA_POSITION_EPSILON_MS = 2;

export interface MediaState {
  selectorPath: string[];
  /** Hash of the local source locator, never a hash of decoded/file contents. */
  locatorSha256?: string;
  sourceKind: 'URL' | 'STREAM' | 'UNAVAILABLE';
  durationMs: number | null;
  timeMs: number;
  playbackRate: number;
  loop: boolean;
  paused: boolean;
  seekable: [number, number][];
}
export interface MediaSample {
  atMs: number;
  timeMs: number;
  paused: boolean;
  ended: boolean;
  seeking: boolean;
  playbackRate: number;
  loop: boolean;
  presentation?: { timeMs: number; count: number; wraps: number };
}
export interface MediaPresentation {
  atMs: number;
  timeMs: number;
  /** Browser compositor metadata, not our own timer/callback count. */
  presentedFrames: number;
}
export interface MediaEvidence {
  version: 1;
  complete: boolean;
  startedEpochMs?: number;
  endedEpochMs?: number;
  reasons: string[];
  items: {
    before: MediaState;
    after: MediaState;
    samples: MediaSample[];
    presentations?: MediaPresentation[];
  }[];
}
export interface MediaReplayPlan {
  version: 1;
  status: 'REPLAYABLE' | 'UNSUPPORTED';
  reasons: string[];
  items: MediaState[];
  /** Actual original interval endpoints, used only to extend a replay by <=500ms. */
  coverage?: {
    endMs: number;
    wraps: number;
    presentedEndMs?: number;
    presentedWraps?: number;
  }[];
}

const finite = (value: unknown, max = 86_400_000): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= max;
const path = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= 8 &&
  value.every(
    (part) =>
      typeof part === 'string' && part.length > 0 && part.length <= 1000,
  );
export function validMediaState(value: unknown): value is MediaState {
  if (!value || typeof value !== 'object') return false;
  const v = value as MediaState;
  return (
    path(v.selectorPath) &&
    ['URL', 'STREAM', 'UNAVAILABLE'].includes(v.sourceKind) &&
    (v.locatorSha256 === undefined ||
      (typeof v.locatorSha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(v.locatorSha256))) &&
    (v.durationMs === null || finite(v.durationMs)) &&
    finite(v.timeMs) &&
    finite(v.playbackRate, 16) &&
    v.playbackRate > 0 &&
    typeof v.loop === 'boolean' &&
    typeof v.paused === 'boolean' &&
    Array.isArray(v.seekable) &&
    v.seekable.length <= 16 &&
    v.seekable.every(
      (range) =>
        Array.isArray(range) &&
        range.length === 2 &&
        finite(range[0]) &&
        finite(range[1]) &&
        range[1] >= range[0],
    )
  );
}
const reasonsValid = (reasons: unknown): reasons is string[] =>
  Array.isArray(reasons) &&
  reasons.length <= 32 &&
  reasons.every(
    (reason) => typeof reason === 'string' && /^[A-Z0-9_]{1,100}$/.test(reason),
  );
export function validMediaPlan(value: unknown): value is MediaReplayPlan {
  if (!value || typeof value !== 'object') return false;
  const v = value as MediaReplayPlan;
  return (
    v.version === 1 &&
    ['REPLAYABLE', 'UNSUPPORTED'].includes(v.status) &&
    reasonsValid(v.reasons) &&
    Array.isArray(v.items) &&
    v.items.length <= MEDIA_REPLAY_LIMIT &&
    v.items.every(validMediaState) &&
    new Set(v.items.map((item) => JSON.stringify(item.selectorPath))).size ===
      v.items.length &&
    (v.coverage === undefined ||
      (Array.isArray(v.coverage) &&
        v.coverage.length === v.items.length &&
        v.coverage.every(
          (item) =>
            item &&
            typeof item === 'object' &&
            finite(item.endMs, 172_800_000) &&
            Number.isInteger(item.wraps) &&
            item.wraps >= 0 &&
            item.wraps <= 1000 &&
            (item.presentedEndMs === undefined ||
              finite(item.presentedEndMs, 172_800_000)) &&
            (item.presentedWraps === undefined ||
              (Number.isInteger(item.presentedWraps) &&
                item.presentedWraps >= 0 &&
                item.presentedWraps <= 1000)),
        ))) &&
    (v.status !== 'REPLAYABLE' ||
      (v.reasons.length === 0 && v.items.every(replayableMediaState)))
  );
}
export function validMediaEvidence(value: unknown): value is MediaEvidence {
  if (!value || typeof value !== 'object') return false;
  const v = value as MediaEvidence;
  return (
    v.version === 1 &&
    typeof v.complete === 'boolean' &&
    reasonsValid(v.reasons) &&
    (v.startedEpochMs === undefined || finite(v.startedEpochMs, 1e14)) &&
    (v.endedEpochMs === undefined || finite(v.endedEpochMs, 1e14)) &&
    (!v.complete ||
      (v.startedEpochMs !== undefined &&
        v.endedEpochMs !== undefined &&
        v.endedEpochMs >= v.startedEpochMs &&
        v.endedEpochMs - v.startedEpochMs <= 130_000)) &&
    Array.isArray(v.items) &&
    v.items.length <= MEDIA_REPLAY_LIMIT &&
    v.items.every(
      (item) =>
        validMediaState(item?.before) &&
        validMediaState(item?.after) &&
        (item.presentations === undefined ||
          (Array.isArray(item.presentations) &&
            item.presentations.length <= MEDIA_PRESENTATION_LIMIT &&
            item.presentations.every(
              (frame, index) =>
                frame &&
                typeof frame === 'object' &&
                finite(frame.atMs, 130_000) &&
                finite(frame.timeMs) &&
                Number.isInteger(frame.presentedFrames) &&
                frame.presentedFrames > 0 &&
                frame.presentedFrames <= 1e12 &&
                (index === 0 ||
                  frame.atMs >= item.presentations![index - 1].atMs),
            ))) &&
        Array.isArray(item.samples) &&
        item.samples.length > 0 &&
        item.samples.length <= MEDIA_SAMPLE_LIMIT &&
        item.samples.every(
          (sample, index) =>
            sample &&
            typeof sample === 'object' &&
            finite(sample.atMs, 130_000) &&
            finite(sample.timeMs) &&
            typeof sample.paused === 'boolean' &&
            typeof sample.ended === 'boolean' &&
            typeof sample.seeking === 'boolean' &&
            typeof sample.loop === 'boolean' &&
            (sample.presentation === undefined ||
              (sample.presentation &&
                typeof sample.presentation === 'object' &&
                finite(sample.presentation.timeMs) &&
                Number.isInteger(sample.presentation.count) &&
                sample.presentation.count > 0 &&
                sample.presentation.count <= 100_000 &&
                Number.isInteger(sample.presentation.wraps) &&
                sample.presentation.wraps >= 0 &&
                sample.presentation.wraps <= 1000)) &&
            finite(sample.playbackRate, 16) &&
            sample.playbackRate > 0 &&
            (index === 0 || sample.atMs >= item.samples[index - 1].atMs),
        ),
    ) &&
    new Set(v.items.map((item) => JSON.stringify(item.before.selectorPath)))
      .size === v.items.length &&
    (!v.complete || v.reasons.length === 0)
  );
}
export function replayableMediaState(state: MediaState): boolean {
  return (
    state.sourceKind === 'URL' &&
    Boolean(state.locatorSha256) &&
    state.durationMs !== null &&
    state.durationMs > 0 &&
    state.timeMs <= state.durationMs &&
    state.seekable.some(
      ([start, end]) => start <= state.timeMs && end >= state.timeMs,
    )
  );
}
function sameSource(a: MediaState, b: MediaState): boolean {
  return (
    JSON.stringify(a.selectorPath) === JSON.stringify(b.selectorPath) &&
    a.locatorSha256 === b.locatorSha256 &&
    a.sourceKind === b.sourceKind &&
    a.durationMs === b.durationMs &&
    a.playbackRate === b.playbackRate &&
    a.loop === b.loop
  );
}
/** Actual compositor submissions, kept separate from the advancing playback
 * clock. A stream of callbacks/counters alone cannot prove decoded clip coverage. */
function presentedSequence(
  item: MediaEvidence['items'][number],
): { points: number[]; wraps: number } | undefined {
  const frames = item.presentations ?? [];
  const samples = item.samples;
  const first = samples[0],
    last = samples.at(-1);
  if (!first || !last) return;
  const stationary = samples.every(
    (sample) =>
      (sample.paused || sample.ended) &&
      Math.abs(sample.timeMs - first.timeMs) <= MEDIA_POSITION_EPSILON_MS,
  );
  if (stationary && frames.length <= 1)
    return { points: frames.map((frame) => frame.timeMs), wraps: 0 };
  if (frames.length < 2) return;
  let offset = 0,
    wraps = 0;
  const points: number[] = [];
  for (const [index, frame] of frames.entries()) {
    if (
      frame.atMs < first.atMs ||
      frame.atMs > last.atMs + MEDIA_POSITION_EPSILON_MS
    )
      return;
    const previous = frames[index - 1];
    if (previous) {
      // Gaps in the browser's own counter are missed presentation callbacks.
      // Do not infer their media PTS from the count.
      if (frame.presentedFrames !== previous.presentedFrames + 1) return;
      if (frame.timeMs + MEDIA_POSITION_EPSILON_MS < previous.timeMs) {
        const duration = item.before.durationMs;
        if (
          !item.before.loop ||
          !duration ||
          duration / item.before.playbackRate <= 500 ||
          previous.timeMs < duration - 250 * item.before.playbackRate ||
          frame.timeMs > 250 * item.before.playbackRate
        )
          return;
        offset += duration;
        wraps++;
      } else if (frame.timeMs <= previous.timeMs + MEDIA_POSITION_EPSILON_MS)
        return;
    }
    points.push(offset + frame.timeMs);
  }
  // While playback is moving, stale/missing compositor evidence >250ms is
  // unsupported, even if currentTime advances and tabCapture itself is healthy.
  let cursor = -1,
    playingSince: number | undefined;
  for (const sample of samples) {
    while (cursor + 1 < frames.length && frames[cursor + 1].atMs <= sample.atMs)
      cursor++;
    if (sample.paused || sample.ended) {
      playingSince = undefined;
      continue;
    }
    playingSince ??= sample.atMs;
    if (
      sample.atMs - playingSince > 250 &&
      (cursor < 0 || sample.atMs - frames[cursor].atMs > 250)
    )
      return;
  }
  return { points, wraps };
}
/** Returns the genuinely observed unwrapped media interval, never elapsed wall time. */
export function measuredMediaInterval(item: MediaEvidence['items'][number]):
  | {
      startMs: number;
      endMs: number;
      wraps: number;
      presentedWraps: number;
      presentations: number;
      presentedEndMs?: number;
    }
  | undefined {
  if (!sameSource(item.before, item.after)) return;
  const first = item.samples[0];
  if (!first) return;
  let previous = first,
    offset = 0,
    lastProgressAt = first.atMs,
    wraps = 0;
  let presentation = first.presentation;
  for (const sample of item.samples.slice(1)) {
    const deltaAt = sample.atMs - previous.atMs;
    if (sample.presentation) {
      if (
        presentation &&
        (sample.presentation.count < presentation.count ||
          sample.presentation.wraps < presentation.wraps ||
          (sample.presentation.count === presentation.count &&
            (sample.presentation.timeMs !== presentation.timeMs ||
              sample.presentation.wraps !== presentation.wraps)))
      )
        return;
      presentation = sample.presentation;
    }
    if (
      sample.playbackRate !== item.before.playbackRate ||
      sample.loop !== item.before.loop ||
      deltaAt > 250
    )
      return;
    let advance = sample.timeMs - previous.timeMs;
    const wrapped = sample.timeMs + MEDIA_POSITION_EPSILON_MS < previous.timeMs;
    if (wrapped) {
      const duration = item.before.durationMs;
      if (
        !item.before.loop ||
        !duration ||
        previous.timeMs < duration - 250 * sample.playbackRate ||
        sample.timeMs > 250 * sample.playbackRate ||
        duration / sample.playbackRate <= 500
      )
        return;
      advance += duration;
      offset += duration;
      wraps++;
    }
    // A seek may start and finish between timer samples. Neither a missing
    // seeking flag nor later coverage can justify skipping unseen content.
    if (advance > deltaAt * sample.playbackRate + MEDIA_POSITION_EPSILON_MS)
      return;
    if (
      sample.seeking &&
      !wrapped &&
      Math.abs(sample.timeMs - first.timeMs) > MEDIA_POSITION_EPSILON_MS &&
      !(
        item.before.loop &&
        sample.timeMs <= MEDIA_POSITION_EPSILON_MS &&
        previous.timeMs <= 250 * sample.playbackRate
      )
    )
      return;
    if (sample.timeMs !== previous.timeMs || sample.paused || sample.ended)
      lastProgressAt = sample.atMs;
    if (!sample.paused && !sample.ended && sample.atMs - lastProgressAt > 250)
      return;
    previous = sample;
  }
  const presented = presentedSequence(item);
  if (!presented) return;
  return {
    startMs: first.timeMs,
    endMs: offset + previous.timeMs,
    wraps,
    presentedWraps: presented.wraps,
    presentations: presented.points.length,
    ...(presented.points.length
      ? { presentedEndMs: presented.points.at(-1)! }
      : {}),
  };
}
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
  if (
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
  )
    return [];
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
  if (known && finding) {
    const clock = finding.sourceTimeline;
    if (
      !clock?.frameClock ||
      clock.windowStartEpochMs - clock.frameClock.startBoundaryErrorMs <
        before.startedEpochMs! ||
      clock.windowEndEpochMs + clock.frameClock.endBoundaryErrorMs >
        before.endedEpochMs!
    )
      return [
        'Het oorspronkelijke mediasignaal ligt niet aantoonbaar binnen het geregistreerde clipinterval; de bronklok blijft een ontvangstschatting.',
      ];
  }
  if (
    before.items.length !== after.items.length ||
    before.items.length !== plan.items.length
  )
    return ['De aanwezige media verschillen tussen de metingen.'];
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

/** Explicit copy: content replies cannot smuggle source URLs into persisted data. */
export function copyMediaEvidence(value: unknown): MediaEvidence | undefined {
  if (!validMediaEvidence(value)) return;
  return {
    version: 1,
    complete: value.complete,
    reasons: [...value.reasons],
    ...(value.startedEpochMs !== undefined
      ? { startedEpochMs: value.startedEpochMs }
      : {}),
    ...(value.endedEpochMs !== undefined
      ? { endedEpochMs: value.endedEpochMs }
      : {}),
    items: value.items.map((item) => ({
      before: copyMediaState(item.before),
      after: copyMediaState(item.after),
      ...(item.presentations
        ? {
            presentations: item.presentations.map((frame) => ({
              atMs: frame.atMs,
              timeMs: frame.timeMs,
              presentedFrames: frame.presentedFrames,
            })),
          }
        : {}),
      samples: item.samples.map((s) => ({
        atMs: s.atMs,
        timeMs: s.timeMs,
        paused: s.paused,
        ended: s.ended,
        seeking: s.seeking,
        playbackRate: s.playbackRate,
        loop: s.loop,
        ...(s.presentation
          ? {
              presentation: {
                timeMs: s.presentation.timeMs,
                count: s.presentation.count,
                wraps: s.presentation.wraps,
              },
            }
          : {}),
      })),
    })),
  };
}
export function copyMediaState(s: MediaState): MediaState {
  return {
    selectorPath: [...s.selectorPath],
    sourceKind: s.sourceKind,
    ...(s.locatorSha256 ? { locatorSha256: s.locatorSha256 } : {}),
    durationMs: s.durationMs,
    timeMs: s.timeMs,
    playbackRate: s.playbackRate,
    loop: s.loop,
    paused: s.paused,
    seekable: s.seekable.map(([a, b]) => [a, b]),
  };
}
