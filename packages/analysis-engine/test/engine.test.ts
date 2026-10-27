import { describe, expect, it } from 'vitest';
import { FrameAnalyzer, relativeLuminance } from '../src/index.js';

function capture(
  pixel: (time: number, x: number) => readonly number[],
  duration = 2200,
  width = 1,
  step = 10,
) {
  const analyzer = new FrameAnalyzer();
  for (let time = 0; time <= duration; time += step) {
    const rgba = new Uint8Array(width * 4);
    for (let x = 0; x < width; x++) rgba.set([...pixel(time, x), 255], x * 4);
    analyzer.pushFrame({ rgba, width, height: 1, timestampMs: 100_000 + time });
  }
  return analyzer.finish();
}
const monochrome = (value: number) => [value, value, value];

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
  it('keeps separate simultaneously flashing regions separate', () => {
    const result = capture(
      (time, x) =>
        x === 1
          ? monochrome(100)
          : monochrome(Math.floor((time * 8) / 1000) % 2 ? 255 : 0),
      2200,
      3,
    );
    expect(result.findings).toHaveLength(2);
    expect(result.findings.map((finding) => finding.region?.x)).toEqual([0, 2]);
    expect(result.findings[0].affectedRatio).toBeCloseTo(1 / 3);
  });
  it('detects saturated red/green chromaticity candidates without claiming conformance', () => {
    const result = capture((time) =>
      Math.floor((time * 8) / 1000) % 2 ? [255, 0, 0] : [0, 255, 0],
    );
    expect(
      result.findings.some((finding) => finding.type === 'RED_FLASH'),
    ).toBe(true);
    expect(result.passed).toBeNull();
  });
  it('detects disjoint red pairs when successive excursions use different colours', () => {
    const colors = [
      [0, 255, 0],
      [255, 0, 0],
      [0, 0, 255],
      [255, 0, 0],
      [0, 255, 0],
      [255, 0, 0],
      [0, 0, 255],
      [255, 0, 0],
      [0, 255, 0],
    ];
    const result = capture(
      (time) => colors[Math.min(8, Math.floor(time / 100))],
    );
    expect(
      result.findings.find((finding) => finding.type === 'RED_FLASH'),
    ).toMatchObject({
      startMs: 100,
      endMs: 800,
      flashesInWindow: 3.5,
      qualifyingTransitions: 7,
    });
    expect(result.passed).toBeNull();
  });
  it('uses actual capture timestamps rather than nominal frame numbers', () => {
    const fast = capture((time) =>
      monochrome(Math.floor((time * 8) / 1000) % 2 ? 255 : 0),
    );
    const slow = new FrameAnalyzer();
    for (let frame = 0; frame <= 220; frame++) {
      const value = Math.floor((frame * 10 * 8) / 1000) % 2 ? 255 : 0;
      slow.pushFrame({
        rgba: new Uint8Array([value, value, value, 255]),
        width: 1,
        height: 1,
        timestampMs: frame * 20,
      });
    }
    expect(fast.findings.length).toBeGreaterThan(0);
    expect(slow.finish().findings).toHaveLength(0);
    expect(slow.finish().quality.effectiveFps).toBe(50);
  });
  it('degrades gaps, low sampling, rescaling, interruptions and malformed frames', () => {
    const analyzer = new FrameAnalyzer();
    for (const time of [0, 50, 100, 1000, 1050])
      analyzer.pushFrame({
        rgba: new Uint8Array([0, 0, 0, 255]),
        width: 1,
        height: 1,
        timestampMs: time,
        sourceWidth: 2,
        sourceHeight: 2,
      });
    analyzer.markInterrupted();
    const result = analyzer.finish();
    expect(result.status).toBe('INCONCLUSIVE');
    expect(result.quality.maxGapMs).toBe(900);
    expect(result.quality.downsampled).toBe(true);
    expect(result.quality.interrupted).toBe(true);
    expect(new FrameAnalyzer().finish().status).toBe('INCONCLUSIVE');
    const malformed = new FrameAnalyzer();
    malformed.pushFrame({
      rgba: new Uint8Array(1),
      width: 1,
      height: 1,
      timestampMs: 0,
    });
    expect(malformed.finish().status).toBe('INCONCLUSIVE');
  });
  it('does not join opposing transitions across a capture gap', () => {
    const analyzer = new FrameAnalyzer();
    for (const [time, value] of [
      [0, 0],
      [20, 255],
      [40, 0],
      [60, 255],
      [80, 0],
      [100, 255],
      [120, 0],
      [400, 255],
    ]) {
      analyzer.pushFrame({
        rgba: new Uint8Array([value, value, value, 255]),
        width: 1,
        height: 1,
        timestampMs: time,
      });
    }
    expect(analyzer.finish().findings).toEqual([]);
  });
  it('ages prior flashes during repeated identical frames without inventing a new window', () => {
    const result = capture((time) =>
      monochrome(
        [100, 200, 300, 1500].some(
          (start) => time >= start && time < start + 40,
        )
          ? 255
          : 0,
      ),
    );
    expect(result.findings).toHaveLength(0);
    expect(result.quality.frameCount).toBe(221);
    expect(result.quality.effectiveFps).toBe(100);
  });
  it('does not combine flashes across an unsupported transparent pixel', () => {
    const analyzer = new FrameAnalyzer();
    for (let time = 0; time <= 1000; time += 10) {
      const value = [100, 200, 300, 400].some(
        (start) => time >= start && time < start + 40,
      )
        ? 255
        : 0;
      analyzer.pushFrame({
        rgba: new Uint8Array([value, value, value, time === 350 ? 0 : 255]),
        width: 1,
        height: 1,
        timestampMs: time,
      });
    }
    expect(analyzer.finish().status).toBe('INCONCLUSIVE');
    expect(analyzer.finish().findings).toHaveLength(0);
  });
  it('does not join red histories across undefined black-point chromaticity', () => {
    const result = capture((time) => {
      if (time === 350) return [0, 0, 0];
      return [100, 200, 300, 400].some(
        (start) => time >= start && time < start + 40,
      )
        ? [255, 0, 0]
        : [0, 255, 0];
    });
    expect(
      result.findings.filter((finding) => finding.type === 'RED_FLASH'),
    ).toHaveLength(0);
  });
  it('resets temporal correspondence when source dimensions change at the same analysis size', () => {
    const analyzer = new FrameAnalyzer();
    for (let time = 0; time <= 1000; time += 10) {
      const value = [100, 200, 300, 400].some(
        (start) => time >= start && time < start + 40,
      )
        ? 255
        : 0;
      analyzer.pushFrame({
        rgba: new Uint8Array([value, value, value, 255]),
        width: 1,
        height: 1,
        sourceWidth: time < 350 ? 1920 : 1280,
        sourceHeight: time < 350 ? 1080 : 720,
        timestampMs: time,
      });
    }
    const result = analyzer.finish();
    expect(result.findings).toHaveLength(0);
    expect(result.quality.interrupted).toBe(true);
    expect(
      result.limitations.some((note) =>
        note.includes('Source dimensions changed'),
      ),
    ).toBe(true);
  });
  it('keeps completed findings separate across a capture interruption', () => {
    const analyzer = new FrameAnalyzer();
    for (let time = 0; time <= 1400; time += 10) {
      if (time === 550) analyzer.markInterrupted('Test interruption');
      const value = [100, 200, 300, 400, 700, 800, 900, 1000].some(
        (start) => time >= start && time < start + 40,
      )
        ? 255
        : 0;
      analyzer.pushFrame({
        rgba: new Uint8Array([value, value, value, 255]),
        width: 1,
        height: 1,
        timestampMs: time,
      });
    }
    expect(analyzer.finish().findings).toMatchObject([
      { startMs: 100, endMs: 440 },
      { startMs: 700, endMs: 1040 },
    ]);
  });
  it('rejects malformed source dimensions before using pixel correspondence', () => {
    for (const sourceWidth of [0, -1, NaN, Infinity, 1.5, 16385]) {
      const analyzer = new FrameAnalyzer();
      analyzer.pushFrame({
        rgba: new Uint8Array([0, 0, 0, 255]),
        width: 1,
        height: 1,
        sourceWidth,
        timestampMs: 0,
      });
      expect(analyzer.finish().status).toBe('INCONCLUSIVE');
      expect(analyzer.finish().quality.frameCount).toBe(0);
    }
  });
});

describe('bounded representative-pixel diagnostics', () => {
  it('retains numeric RGB samples and exact analysis coordinates without images', () => {
    const result = capture(
      (time, x) =>
        x === 1
          ? monochrome(100)
          : monochrome(Math.floor(time / 100) % 2 ? 255 : 0),
      1400,
      3,
      20,
    );
    expect(result.findings).toHaveLength(2);
    for (const [i, point] of [0, 2].entries()) {
      const finding = result.findings[i];
      expect(finding.diagnostic).toMatchObject({
        version: 1,
        coordinateSpace: 'ANALYSIS_PIXELS',
        point: { x: point, y: 0 },
        analysisWidth: 3,
        analysisHeight: 1,
        sourceWidth: 3,
        sourceHeight: 1,
        complete: true,
      });
      const diagnostic = finding.diagnostic!;
      expect(diagnostic.samples[0].timestampMs).toBeLessThan(
        diagnostic.windowStartMs,
      );
      expect(diagnostic.samples.at(-1)!.timestampMs).toBe(
        diagnostic.windowEndMs,
      );
      expect(
        diagnostic.samples.some(
          (sample) =>
            sample.red === 255 && sample.green === 255 && sample.blue === 255,
        ),
      ).toBe(true);
      expect(
        diagnostic.samples.some(
          (sample) =>
            sample.red === 0 && sample.green === 0 && sample.blue === 0,
        ),
      ).toBe(true);
      expect(Object.keys(diagnostic)).not.toContain('rgba');
      // The initial evidence window remains frozen when a continuous finding grows.
      expect(finding.endMs).toBeGreaterThan(diagnostic.windowEndMs);
    }
  });
  it('marks an overwritten sample window incomplete while keeping detection active', () => {
    const result = capture(
      (time) => monochrome(Math.floor(time / 100) % 2 ? 255 : 0),
      1200,
      1,
      1,
    );
    const diagnostic = result.findings[0].diagnostic!;
    expect(diagnostic.samples.length).toBeLessThanOrEqual(96);
    expect(diagnostic.complete).toBe(false);
    expect(diagnostic.omissions?.join(' ')).toContain('bounded sample history');
    expect(result.findings[0].reviewStatus).toBe('NEEDS_REVIEW');
  });
  it('never joins evidence across changed source dimensions or an explicit interruption', () => {
    for (const mode of ['source', 'interrupt']) {
      const analyzer = new FrameAnalyzer();
      for (let time = 0; time <= 2400; time += 20) {
        if (mode === 'interrupt' && time === 1200) analyzer.markInterrupted();
        const value = Math.floor(time / 100) % 2 ? 255 : 0;
        analyzer.pushFrame({
          rgba: new Uint8Array([value, value, value, 255]),
          width: 1,
          height: 1,
          sourceWidth: mode === 'source' && time >= 1200 ? 2 : 1,
          timestampMs: time,
        });
      }
      const findings = analyzer.finish().findings;
      expect(findings).toHaveLength(2);
      expect(
        findings[1].diagnostic!.samples[0].timestampMs,
      ).toBeGreaterThanOrEqual(1200);
      expect(findings[1].diagnostic!.sourceWidth).toBe(
        mode === 'source' ? 2 : 1,
      );
    }
  });
  it('can disable trace retention for headless numeric benchmarks', () => {
    const analyzer = new FrameAnalyzer({ diagnostics: false });
    for (let time = 0; time <= 1200; time += 20) {
      const value = Math.floor(time / 100) % 2 ? 255 : 0;
      analyzer.pushFrame({
        rgba: new Uint8Array([value, value, value, 255]),
        width: 1,
        height: 1,
        timestampMs: time,
      });
    }
    expect(analyzer.finish().findings.length).toBeGreaterThan(0);
    expect(
      analyzer
        .finish()
        .findings.every((finding) => finding.diagnostic === undefined),
    ).toBe(true);
  });
});
