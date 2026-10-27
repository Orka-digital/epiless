import { referenceColor, type NumericSample, type Rgb } from './reference.js';

export interface NumericCase {
  id: string;
  family: string;
  samples: NumericSample[];
}
const gray = (v: number): Rgb => [v, v, v];
const black = gray(0),
  white = gray(255);
const red: Rgb = [255, 0, 0];
const green: Rgb = [0, 255, 0];
const blue: Rgb = [0, 0, 255];

function fixture(
  id: string,
  family: string,
  colors: readonly Rgb[],
  changes: readonly number[],
  duration = 2200,
): NumericCase {
  const samples: NumericSample[] = [];
  let state = 0;
  for (let time = 0; time <= duration; time += 10) {
    while (state < changes.length && changes[state] <= time) state++;
    samples.push({ time, rgb: colors[state % colors.length] });
  }
  return { id, family, samples };
}
const regular = (frequency: number, phase: number, duration: number) => {
  const changes = [];
  for (let time = phase; time <= duration; time += 1000 / (2 * frequency))
    changes.push(Math.round(time / 10) * 10);
  return changes;
};

export function numericCorpus(): NumericCase[] {
  const cases: NumericCase[] = [];
  for (const frequency of [1, 2, 3, 4, 5, 8, 12, 20]) {
    for (const phase of [10, 40, 90, 150]) {
      for (const [name, colors] of [
        ['luminance', [black, white]],
        ['red-green', [red, green]],
        ['red-blue', [red, blue]],
        ['gray-below-threshold', [black, gray(89)]],
        ['gray-above-threshold', [black, gray(90)]],
        ['bright-below-cutoff', [gray(231), white]],
        ['bright-above-cutoff', [gray(232), white]],
        ['non-red', [green, blue]],
        ['undefined-black', [red, black]],
      ] as const)
        cases.push(
          fixture(
            `${name}-${frequency}hz-phase${phase}`,
            'frequency-phase-threshold',
            colors,
            regular(frequency, phase, 2200),
          ),
        );
    }
  }
  for (const [id, changes] of [
    ['seven-edges', [100, 200, 300, 400, 500, 600, 700]],
    ['eight-edges-exact-second', [100, 240, 380, 520, 660, 800, 940, 1100]],
    ['eight-edges-over-second', [100, 240, 380, 520, 660, 800, 940, 1110]],
    ['earlier-odd-edge', [100, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800]],
    ['calendar-boundary', [850, 890, 950, 990, 1050, 1090, 1150, 1190]],
    ['expired-early-pairs', [100, 140, 200, 240, 300, 340, 1500, 1540]],
  ] as const)
    for (const [name, colors] of [
      ['general', [black, white]],
      ['red', [red, green]],
    ] as const)
      cases.push(fixture(`${id}-${name}`, 'window-boundary', colors, changes));

  // Full 8-bit sweeps bracket the numerical luminance and bright-state limits.
  for (let value = 0; value < 256; value++) {
    cases.push(
      fixture(
        `luminance-low-${value}`,
        'luminance-boundary-sweep',
        [black, gray(value)],
        regular(5, 50, 1600),
        1600,
      ),
    );
    cases.push(
      fixture(
        `luminance-high-${value}`,
        'luminance-boundary-sweep',
        [gray(value), white],
        regular(5, 50, 1600),
        1600,
      ),
    );
  }
  // Saturation near R/(R+G+B)=0.8 and distance near delta-u'v'=0.2.
  // Expected labels are computed from the source byte values, never copied from the engine.
  for (let value = 0; value < 256; value++) {
    cases.push(
      fixture(
        `red-saturation-${value}`,
        'red-boundary-sweep',
        [[255, value, 0], blue],
        regular(5, 50, 1600),
        1600,
      ),
    );
    cases.push(
      fixture(
        `red-distance-${value}`,
        'red-boundary-sweep',
        [red, [255, value, value]],
        regular(5, 50, 1600),
        1600,
      ),
    );
  }
  let random = 0x5eed2301;
  const next = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0);
  for (let trial = 0; trial < 300; trial++) {
    let time = 0;
    const changes: number[] = [];
    for (let i = 0; i < 18; i++) {
      time += (1 + (next() % 40)) * 10;
      changes.push(time);
    }
    const colors: Rgb[] =
      trial % 3 === 0
        ? [black, white]
        : trial % 3 === 1
          ? [red, green]
          : [
              [next() % 256, next() % 256, next() % 256],
              [next() % 256, next() % 256, next() % 256],
            ];
    cases.push(
      fixture(
        `seeded-irregular-${trial}`,
        'seeded-step-sequences',
        colors,
        changes,
        time + 100,
      ),
    );
  }
  // Saturated red excursions can alternate through different destination colours.
  cases.push(
    fixture(
      'red-mixed-opposing-colors',
      'red-pairing',
      [green, red, blue, red, green, red, blue, red, green],
      [100, 200, 300, 400, 500, 600, 700, 800],
    ),
  );
  for (const discontinuity of [
    'capture-gap',
    'source-change',
    'transparent-pixel',
    'interruption',
    'black-point',
  ] as const) {
    const input = fixture(
      discontinuity,
      'discontinuity',
      [red, green],
      [100, 140, 200, 240, 300, 340, 400, 440],
    );
    if (discontinuity === 'capture-gap')
      input.samples = input.samples.filter(
        ({ time }) => time <= 340 || time >= 450,
      );
    if (discontinuity === 'source-change')
      input.samples.forEach((sample) => {
        sample.sourceWidth = sample.time < 350 ? 1 : 2;
      });
    if (discontinuity === 'transparent-pixel')
      input.samples.find(({ time }) => time === 350)!.alpha = 0;
    if (discontinuity === 'interruption')
      input.samples.find(({ time }) => time === 350)!.interrupted = true;
    if (discontinuity === 'black-point')
      input.samples.find(({ time }) => time === 350)!.rgb = black;
    cases.push(input);
  }
  return cases;
}

export function boundaryProbes() {
  const low = referenceColor(gray(89)).y,
    high = referenceColor(gray(90)).y;
  return {
    luminanceDelta: { below: low, above: high, threshold: 0.1 },
    darkerState: {
      below: referenceColor(gray(231)).y,
      above: referenceColor(gray(232)).y,
      threshold: 0.8,
    },
    redSaturation: [136, 137].map((g) => ({
      rgb: [255, g, 0],
      saturated: referenceColor([255, g, 0]).red,
    })),
  };
}
