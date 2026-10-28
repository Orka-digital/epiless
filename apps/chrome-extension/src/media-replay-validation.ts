import {
  MEDIA_PRESENTATION_LIMIT,
  MEDIA_REPLAY_LIMIT,
  MEDIA_SAMPLE_LIMIT,
  type MediaEvidence,
  type MediaReplayPlan,
  type MediaState,
} from './media-replay-types';

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

/**
 * Validate the bounded, URL-free shape of an untrusted media state.
 * @returns Whether the value is structurally valid; this does not prove replayability.
 */
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

/**
 * Validate a saved plan and its bounded endpoint coverage before replay.
 * @returns False for malformed or inconsistent plans; no media is played here.
 */
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

/**
 * Validate sample order, bounds and completeness metadata from content messages.
 * @returns Structural validity only; interval and presentation checks remain separate.
 */
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

/**
 * Copy only transport-approved media fields and detach nested mutable arrays.
 */
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

/**
 * Require an identified file source with a seekable recorded start position.
 * @returns False for streams, unavailable identities or an unseekable start.
 */
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

/**
 * Compare locator and playback identity, not encoded bytes or visual content.
 */
export function sameSource(a: MediaState, b: MediaState): boolean {
  return (
    JSON.stringify(a.selectorPath) === JSON.stringify(b.selectorPath) &&
    a.locatorSha256 === b.locatorSha256 &&
    a.sourceKind === b.sourceKind &&
    a.durationMs === b.durationMs &&
    a.playbackRate === b.playbackRate &&
    a.loop === b.loop
  );
}
