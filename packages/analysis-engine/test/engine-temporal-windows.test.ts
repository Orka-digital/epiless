import { describe, expect, it } from 'vitest';

import { FrameAnalyzer, relativeLuminance } from '../src/index.js';
import { capture, monochrome } from './engine.fixture';
describe('candidate frame engine', () => {
  it('linearizes sRGB correctly at known reference points', () => {
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 10);
    expect(relativeLuminance(255, 0, 0)).toBeCloseTo(0.2126, 10);
    expect(relativeLuminance(128, 128, 128)).toBeCloseTo(0.2158605, 6);
    expect(() => relativeLuminance(256, 0, 0)).toThrow();
  });

  it('does not count a single transition or steady frames as complete flashes', () => {
    for (const input of [
      (time: number) => monochrome(time > 500 ? 255 : 0),
      () => monochrome(100),
    ]) {
      const result = capture(input);
      expect(result.findings).toEqual([]);
      expect(result.status).toBe('NO_ISSUES_OBSERVED');
      expect(result.passed).toBeNull();
    }
  });

  it('distinguishes three from four opposing pairs per rolling second', () => {
    const three = capture((time) =>
      monochrome(Math.floor((time * 6) / 1000) % 2 ? 255 : 0),
    );
    const four = capture((time) =>
      monochrome(Math.floor((time * 8) / 1000) % 2 ? 255 : 0),
    );
    expect(three.findings).toHaveLength(0);
    expect(four.status).toBe('NEEDS_REVIEW');
    expect(four.findings[0].flashesInWindow).toBe(3.5);
    expect(four.findings[0].reviewStatus).toBe('NEEDS_REVIEW');
    expect(four.passed).toBeNull();
  });

  it('detects four pairs in either phase after an earlier slow transition', () => {
    const changes = [100, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800];
    for (const colors of [
      [monochrome(0), monochrome(255)],
      [
        [255, 0, 0],
        [0, 255, 0],
      ],
    ]) {
      const result = capture(
        (time) => colors[changes.filter((change) => time >= change).length % 2],
      );
      const finding = result.findings.find((item) =>
        colors[0][0] === 0
          ? item.type === 'GENERAL_FLASH'
          : item.type === 'RED_FLASH',
      );
      expect(finding).toMatchObject({ startMs: 1100, endMs: 1800 });
    }
  });

  it('requires seven alternating transitions inside a half-open one-second window', () => {
    for (const [changes, expected] of [
      [[100, 200, 300, 400, 500, 600], 0],
      [[100, 240, 380, 520, 660, 800, 1090], 1],
      [[100, 240, 380, 520, 660, 800, 1100], 0],
    ] as const) {
      const result = capture((time) =>
        monochrome(
          changes.filter((change) => time >= change).length % 2 ? 255 : 0,
        ),
      );
      expect(result.findings).toHaveLength(expected);
    }
  });

  it('does not double-count a floating-point 30 fps window endpoint', () => {
    for (const colors of [
      [monochrome(0), monochrome(255)],
      [
        [255, 0, 0],
        [0, 255, 0],
      ],
    ]) {
      const analyzer = new FrameAnalyzer();
      for (let frame = 0; frame < 35; frame++) {
        const state =
          [1, 2, 11, 12, 21, 22, 31].filter((change) => change <= frame)
            .length % 2;
        analyzer.pushFrame({
          rgba: new Uint8Array([...colors[state], 255]),
          width: 1,
          height: 1,
          timestampMs: (frame * 1000) / 30,
        });
      }
      expect(analyzer.finish().findings).toHaveLength(0);
    }
  });

  it('matches an independent transition-window oracle across irregular cadence and phase', () => {
    let random = 0xeca11;
    for (let sample = 0; sample < 250; sample++) {
      const changes: number[] = [];
      let time = 0;
      for (let transition = 0; transition < 18; transition++) {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        time += (1 + (random % 40)) * 10;
        changes.push(time);
      }
      const expected = changes.some(
        (changed, index) => index >= 6 && changed - changes[index - 6] < 1000,
      );
      const result = capture(
        (now) =>
          monochrome(
            changes.filter((change) => now >= change).length % 2 ? 255 : 0,
          ),
        time + 100,
      );
      expect(result.findings.length > 0, `sequence ${changes.join(',')}`).toBe(
        expected,
      );
      expect(result.passed).toBeNull();
    }
  });

  it('preserves luminance thresholds and detects gradual alternating excursions', () => {
    const below = capture((time) =>
      monochrome(Math.floor((time * 8) / 1000) % 2 ? 89 : 0),
    );
    const above = capture((time) =>
      monochrome(Math.floor((time * 8) / 1000) % 2 ? 90 : 0),
    );
    const bright = capture((time) =>
      monochrome(Math.floor((time * 8) / 1000) % 2 ? 255 : 232),
    );
    const gradual = capture((time) => {
      const phase = (time % 250) / 250;
      return monochrome(Math.round((1 - Math.abs(phase * 2 - 1)) * 255));
    });
    expect(below.findings).toHaveLength(0);
    expect(
      above.findings.some((finding) => finding.type === 'GENERAL_FLASH'),
    ).toBe(true);
    expect(bright.findings).toHaveLength(0);
    expect(
      gradual.findings.some((finding) => finding.type === 'GENERAL_FLASH'),
    ).toBe(true);
  });

  it('finds a rolling window spanning a calendar-second boundary', () => {
    const result = capture((time) => {
      const pulses = [850, 950, 1050, 1150];
      return monochrome(
        pulses.some((start) => time >= start && time < start + 40) ? 255 : 0,
      );
    });
    expect(result.findings[0].startMs).toBe(850);
    expect(result.findings[0].endMs).toBe(1190);
  });

  it('does not add flashes from unrelated regions to fabricate four local flashes', () => {
    const result = capture(
      (time, x) => {
        if (x === 1) return monochrome(100);
        const shifted = time + (x === 0 ? 0 : 125);
        return monochrome(Math.floor((shifted * 4) / 1000) % 2 ? 255 : 0);
      },
      2200,
      3,
    );
    expect(result.findings).toHaveLength(0);
  });
});
