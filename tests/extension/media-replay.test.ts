import { describe, expect, it } from 'vitest';
import {
  copyMediaEvidence,
  mediaComparisonReasons,
  mediaPlanFromEvidence,
  measuredMediaInterval,
  validMediaEvidence,
  validMediaPlan,
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
function evidence(start = 1000, duration = 1000): MediaEvidence {
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
const observation = (value: MediaEvidence): Observation => ({
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

describe('bounded media replay identity and actual interval coverage', () => {
  it('records seekable media and permits the same actual interval, including a slightly longer replay', () => {
    const original = observation(evidence()),
      next = observation(evidence(1000, 1100));
    expect(validMediaEvidence(original.mediaEvidence)).toBe(true);
    expect(validMediaPlan(original.replay!.mediaPlan)).toBe(true);
    expect(mediaComparisonReasons(original, next)).toEqual([]);
    expect(original.replay!.mediaPlan!.coverage).toEqual([
      { endMs: 2000, wraps: 0, presentedEndMs: 2000, presentedWraps: 0 },
    ]);
  });
  it('rejects different start positions, shortened clips, source locators, rate, duration and loop', () => {
    const original = observation(evidence());
    for (const mutate of [
      (v: MediaEvidence) => {
        v.items[0].before.timeMs += 3;
      },
      (v: MediaEvidence) => {
        v.items[0].samples.pop();
      },
      (v: MediaEvidence) => {
        v.items[0].before.locatorSha256 = 'b'.repeat(64);
      },
      (v: MediaEvidence) => {
        v.items[0].before.playbackRate = 2;
      },
      (v: MediaEvidence) => {
        v.items[0].before.durationMs = 11_000;
      },
      (v: MediaEvidence) => {
        v.items[0].before.loop = true;
      },
    ]) {
      const changed = evidence();
      mutate(changed);
      expect(
        mediaComparisonReasons(original, observation(changed)).length,
      ).toBeGreaterThan(0);
    }
  });
  it('does not accept a forward jump whose seeking flag was missed between timer ticks', () => {
    const data = evidence();
    for (const sample of data.items[0].samples.slice(10)) sample.timeMs += 500;
    expect(measuredMediaInterval(data.items[0])).toBeUndefined();
  });
  it('rejects stalled playback, sparse clocks and mid-clip seeks', () => {
    for (const mutate of [
      (v: MediaEvidence) =>
        v.items[0].samples.forEach((s) => (s.timeMs = 1000)),
      (v: MediaEvidence) => {
        v.items[0].samples = [
          v.items[0].samples[0],
          v.items[0].samples.at(-1)!,
        ];
      },
      (v: MediaEvidence) => {
        v.items[0].samples[10].seeking = true;
      },
    ]) {
      const data = evidence();
      mutate(data);
      expect(measuredMediaInterval(data.items[0])).toBeUndefined();
    }
  });
  it('counts a real bounded loop boundary separately from actual presentation wraps', () => {
    const data = evidence(9750, 1000),
      item = data.items[0];
    item.before.loop = item.after.loop = true;
    for (const sample of item.samples) {
      sample.loop = true;
      if (sample.timeMs >= 10_000) {
        sample.timeMs -= 10_000;
        sample.presentation!.wraps = 1;
      }
      sample.presentation!.timeMs = sample.timeMs;
    }
    item.after.timeMs = 750;
    item.presentations = item.samples.map((sample, index) => ({
      atMs: sample.atMs,
      timeMs: sample.timeMs,
      presentedFrames: index + 1,
    }));
    expect(measuredMediaInterval(item)).toMatchObject({
      startMs: 9750,
      endMs: 10750,
      wraps: 1,
      presentedWraps: 1,
    });
    item.samples.forEach(
      (sample) => delete (sample as Partial<typeof sample>).presentation,
    );
    delete item.presentations;
    expect(measuredMediaInterval(item)).toBeUndefined();
  });
  it('does not treat stream, unknown metadata or unseekable media as file replay', () => {
    for (const mutate of [
      (v: MediaState) => {
        v.sourceKind = 'STREAM';
        delete v.locatorSha256;
      },
      (v: MediaState) => {
        v.durationMs = null;
      },
      (v: MediaState) => {
        v.seekable = [];
      },
    ]) {
      const data = evidence();
      mutate(data.items[0].before);
      expect(mediaPlanFromEvidence(data).status).toBe('UNSUPPORTED');
    }
  });
  it('preserves incompleteness and rejects newly injected media even in a disclosure scenario', () => {
    const original = observation(evidence()),
      next = observation(evidence());
    next.mediaEvidence!.complete = false;
    next.mediaEvidence!.reasons.push('MEDIA_MEMBERSHIP_CHANGED');
    expect(mediaComparisonReasons(original, next).length).toBeGreaterThan(0);
    expect(mediaPlanFromEvidence(next.mediaEvidence).status).toBe(
      'UNSUPPORTED',
    );
    delete original.mediaEvidence;
    delete original.replay!.mediaPlan;
    expect(mediaComparisonReasons(original, next).length).toBeGreaterThan(0);
  });
  it('keeps legacy DOM-only compatibility but never legacy media-action compatibility', () => {
    const original = observation(evidence()),
      next = observation(evidence());
    delete original.mediaEvidence;
    delete original.replay!.mediaPlan;
    next.mediaEvidence!.items = [];
    next.replay!.mediaPlan = mediaPlanFromEvidence(next.mediaEvidence);
    expect(mediaComparisonReasons(original, next)).toEqual([]);
    original.replay!.steps.push({
      kind: 'control',
      target: { kind: 'media', selectorPath: ['video'] },
    });
    expect(mediaComparisonReasons(original, next).length).toBeGreaterThan(0);
  });
  it('requires logical capture boundaries and strips unrecognized source URL fields', () => {
    const data = evidence();
    const copied = copyMediaEvidence({
      ...data,
      url: 'private',
      items: data.items.map((item) => ({
        ...item,
        before: { ...item.before, currentSrc: 'private' },
        extra: 'private',
      })),
    });
    expect(JSON.stringify(copied)).not.toContain('private');
    delete data.startedEpochMs;
    expect(validMediaEvidence(data)).toBe(false);
  });
  it('rejects a plan whose expected begin point differs from its original evidence', () => {
    const original = observation(evidence());
    original.replay!.mediaPlan!.items[0].timeMs = 1100;
    expect(
      mediaComparisonReasons(original, observation(evidence())).length,
    ).toBeGreaterThan(0);
  });
});

describe('real compositor presentation coverage', () => {
  it.each([
    'missing',
    'frozen',
    'counter-only',
    'callback-gap',
    'pts-drop',
    'loop-jump',
  ] as const)('refuses %s while playback time still advances', (kind) => {
    const original = observation(evidence()),
      changed = evidence();
    const frames = changed.items[0].presentations!;
    if (kind === 'missing') delete changed.items[0].presentations;
    if (kind === 'frozen') changed.items[0].presentations = frames.slice(0, 2);
    if (kind === 'counter-only')
      frames.forEach((frame) => (frame.timeMs = 1000));
    if (kind === 'callback-gap') frames[10].presentedFrames += 1;
    if (kind === 'pts-drop') {
      frames.splice(10, 1);
      frames.forEach((frame, index) => (frame.presentedFrames = index + 1));
    }
    if (kind === 'loop-jump') frames[10].timeMs = 0;
    expect(
      mediaComparisonReasons(original, observation(changed)).length,
    ).toBeGreaterThan(0);
  });
  it('does not convert a known video finding with empty media proof into absence', () => {
    const empty = evidence();
    empty.items = [];
    const original = observation(empty),
      next = observation(empty);
    original.replay!.steps = [
      { kind: 'control', target: { kind: 'media', selectorPath: ['video'] } },
    ];
    expect(mediaComparisonReasons(original, next)).toEqual([
      'Een videokandidaat heeft geen geregistreerde media-identiteit of presentatiebewijs.',
    ]);
  });
  it('supports an actually paused stationary video without inventing moving presentations', () => {
    const data = evidence();
    data.items[0].samples.forEach((sample) => {
      sample.paused = true;
      sample.timeMs = 1000;
      delete (sample as Partial<typeof sample>).presentation;
    });
    data.items[0].after = { ...data.items[0].before };
    data.items[0].presentations = [];
    expect(mediaPlanFromEvidence(data).status).toBe('REPLAYABLE');
    expect(
      mediaComparisonReasons(
        observation(data),
        observation(structuredClone(data)),
      ),
    ).toEqual([]);
  });
  it('labels low-cadence playback unsupported instead of interpolating missing presentation evidence', () => {
    const data = evidence();
    data.items[0].presentations = [
      data.items[0].presentations![0],
      { ...data.items[0].presentations!.at(-1)!, presentedFrames: 2 },
    ];
    expect(mediaPlanFromEvidence(data).reasons).toContain(
      'MEDIA_PRESENTATION_COVERAGE_UNPROVEN',
    );
  });
});
