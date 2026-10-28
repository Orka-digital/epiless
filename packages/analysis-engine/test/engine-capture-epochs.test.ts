import { describe, expect, it } from 'vitest';

import { FrameAnalyzer } from '../src/index.js';
describe('candidate frame engine', () => {
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
