import {
  mediaPlanFromEvidence,
  type MediaEvidence,
  type MediaState,
} from '../../apps/chrome-extension/src/media-replay';

import type { Observation } from '../../apps/chrome-extension/src/model';

const state = (): MediaState => ({
  selectorPath: ['video:nth-child(1)'],
  locatorSha256: 'a'.repeat(64),
  sourceKind: 'URL',
  durationMs: 10_000,
  timeMs: 1000,
  playbackRate: 1,
  loop: false,
  paused: true,
  seekable: [[0, 10_000]],
});

export function evidence(start = 1000, duration = 1000): MediaEvidence {
  const before = { ...state(), timeMs: start };
  const samples = Array.from({ length: duration / 50 + 1 }, (_, index) => ({
    atMs: index * 50,
    timeMs: start + index * 50,
    paused: false,
    ended: false,
    seeking: false,
    playbackRate: 1,
    loop: false,
    presentation: { timeMs: start + index * 50, count: index + 1, wraps: 0 },
  }));
  return {
    version: 1,
    complete: true,
    startedEpochMs: 100_000,
    endedEpochMs: 100_000 + duration,
    reasons: [],
    items: [
      {
        before,
        after: { ...before, timeMs: start + duration, paused: false },
        samples,
        presentations: samples.map((sample, index) => ({
          atMs: sample.atMs,
          timeMs: sample.timeMs,
          presentedFrames: index + 1,
        })),
      },
    ],
  };
}

export const observation = (value: MediaEvidence): Observation => ({
  id: 'observation',
  scenario: 'accordion',
  achieved: true,
  startedAt: '',
  endedAt: '',
  mediaEvidence: value,
  replay: {
    version: 1,
    route: 'https://example.test/',
    profile: 'current',
    viewport: { width: 900, height: 600, dpr: 2 },
    durationMs: 1000,
    steps: [],
    stateKey: '',
    mediaPlan: mediaPlanFromEvidence(value),
  },
});
