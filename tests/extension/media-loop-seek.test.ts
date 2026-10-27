import { describe, expect, it } from 'vitest';
import {
  observedLoopSeeks,
  type MediaSeekEvent,
} from '../../apps/chrome-extension/src/media-loop-seek';
import type { MediaEvidence } from '../../apps/chrome-extension/src/media-replay';

function seam(): MediaEvidence['items'][number] {
  const state = {
    selectorPath: ['video'],
    sourceKind: 'URL' as const,
    locatorSha256: 'a'.repeat(64),
    durationMs: 2120,
    timeMs: 2020,
    playbackRate: 1,
    loop: true,
    paused: false,
    seekable: [[0, 2120] as [number, number]],
  };
  return {
    before: state,
    after: { ...state, timeMs: 150 },
    samples: [2020, 2070, 0, 50, 100, 150].map((timeMs, index) => ({
      atMs: index * 50,
      timeMs,
      playbackRate: 1,
      loop: true,
      paused: false,
      ended: false,
      seeking: false,
    })),
    presentations: [2000, 2040, 2080, 0, 40, 80].map((timeMs, index) => ({
      atMs: index * 40,
      timeMs,
      presentedFrames: index + 1,
    })),
  };
}
const seek = (atMs: number): MediaSeekEvent => ({
  atMs,
  timeMs: atMs - 100,
  playbackRate: 1,
  loop: true,
  paused: false,
});
describe('one bounded media-loop witness per seeking event', () => {
  it.each([100, 110, 130])(
    'accepts the event at %sms before or after timer/compositor head delivery',
    (atMs) => {
      const item = seam();
      // At110/130ms the old listener saw only the already-wrapped 0ms sample.
      expect(observedLoopSeeks(item, [seek(atMs)])).toBe(true);
    },
  );
  it('keeps progress unproven until an actual compositor head has arrived', () => {
    const item = seam();
    item.presentations = item.presentations!.slice(0, 3);
    expect(observedLoopSeeks(item, [seek(110)])).toBe(false);
  });
  it('never authorizes two seeking events with one timer or compositor wrap', () => {
    expect(observedLoopSeeks(seam(), [seek(110), seek(130)])).toBe(false);
  });
  it.each([
    'mid-clip',
    'head-to-middle',
    'future-wrap',
    'late',
    'wrong-rate',
    'paused',
    'no-loop',
  ] as const)('rejects %s rather than borrowing a nearby loop', (kind) => {
    const item = seam(),
      event = seek(130);
    if (kind === 'mid-clip') item.samples[1].timeMs = 1000;
    if (kind === 'head-to-middle') event.timeMs = 300;
    if (kind === 'future-wrap') Object.assign(event, { atMs: 90, timeMs: 0 });
    if (kind === 'late') Object.assign(event, { atMs: 351, timeMs: 200 });
    if (kind === 'wrong-rate') event.playbackRate = 2;
    if (kind === 'paused') event.paused = true;
    if (kind === 'no-loop') event.loop = false;
    expect(observedLoopSeeks(item, [event])).toBe(false);
  });
  it.each(['missing', 'counter-gap', 'jump'] as const)(
    'refuses %s compositor boundary evidence',
    (kind) => {
      const item = seam();
      if (kind === 'missing') item.presentations = [];
      if (kind === 'counter-gap') item.presentations![3].presentedFrames++;
      if (kind === 'jump') item.presentations![2].timeMs = 1000;
      expect(observedLoopSeeks(item, [seek(130)])).toBe(false);
    },
  );
});
