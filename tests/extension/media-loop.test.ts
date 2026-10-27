import { describe, expect, it } from 'vitest';
import {
  planLoopBoundary,
  mediaTargetKey,
} from '../../apps/chrome-extension/src/media-loop';
import type { MediaState } from '../../apps/chrome-extension/src/media-replay';

const media = (overrides: Partial<MediaState> = {}): MediaState => ({
  selectorPath: ['video:nth-child(1)'],
  sourceKind: 'URL',
  locatorSha256: 'a'.repeat(64),
  durationMs: 60_000,
  timeMs: 10_000,
  playbackRate: 1,
  loop: true,
  paused: true,
  seekable: [[0, 60_000]],
  ...overrides,
});
const plan = (items: MediaState[], attempted = new Set<string>()) =>
  planLoopBoundary(
    { complete: true, reasons: [], items },
    attempted,
    new Set(items.map(mediaTargetKey)),
  );

describe('targeted existing video loop boundaries', () => {
  it('reaches the boundary after one wall second at the existing playback rate', () => {
    const target = media({ playbackRate: 2 });
    const other = media({ selectorPath: ['video:nth-child(2)'], loop: false });
    const result = plan([target, other]);
    expect('plan' in result).toBe(true);
    if (!('plan' in result)) return;
    expect(result.plan.items[0]).toEqual({
      ...target,
      timeMs: 58_000,
      paused: false,
    });
    expect(result.plan.items[1]).toEqual(other);
    expect(target.timeMs).toBe(10_000);
  });
  it('does not fabricate a loop, seek an unavailable tail or claim streams are replayable', () => {
    expect(plan([media({ loop: false })])).toEqual({
      reason: 'NO_UNTESTED_LOOPING_VIDEO_DISCOVERED',
    });
    expect(plan([media({ seekable: [[0, 59_000]] })])).toEqual({
      reason: 'MEDIA_LOOP_BOUNDARY_NOT_SEEKABLE',
    });
    expect(
      plan([
        media(),
        media({ selectorPath: ['video:nth-child(2)'], sourceKind: 'STREAM' }),
      ]),
    ).toEqual({ reason: 'MEDIA_LOOP_REQUIRES_SEEKABLE_FILE_CONTEXT' });
    expect(
      plan([media({ durationMs: 400, timeMs: 0, seekable: [[0, 400]] })]),
    ).toEqual({ reason: 'MEDIA_LOOP_TOO_SHORT_FOR_RELIABLE_TIME_SAMPLES' });
  });
  it('does not revisit a sampled loop and bounds independent media explorations', () => {
    const target = media();
    expect(plan([target], new Set([mediaTargetKey(target)]))).toEqual({
      reason: 'NO_UNTESTED_LOOPING_VIDEO_DISCOVERED',
    });
    expect(plan([target], new Set(['first', 'second']))).toEqual({
      reason: 'MEDIA_LOOP_SAMPLE_LIMIT_REACHED',
    });
    expect(
      planLoopBoundary(
        { complete: false, reasons: [], items: [target] },
        new Set(),
        new Set([mediaTargetKey(target)]),
      ),
    ).toEqual({ reason: 'MEDIA_LOOP_DISCOVERY_INCOMPLETE' });
    expect(
      planLoopBoundary(
        { complete: true, reasons: [], items: [target] },
        new Set(),
        new Set(),
      ),
    ).toEqual({ reason: 'NO_UNTESTED_LOOPING_VIDEO_DISCOVERED' });
  });
});
