import { describe, expect, it } from 'vitest';

import {
  mediaComparisonReasons,
  mediaPlanFromEvidence,
} from '../../apps/chrome-extension/src/media-replay';

import { evidence, observation } from './media-replay.fixture';
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
