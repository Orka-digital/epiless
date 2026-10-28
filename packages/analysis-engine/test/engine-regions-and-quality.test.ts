import { describe, expect, it } from 'vitest';

import { FrameAnalyzer } from '../src/index.js';
import { capture, monochrome } from './engine.fixture';
describe('candidate frame engine', () => {
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
});
