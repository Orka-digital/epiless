import { describe, expect, it } from 'vitest';

import { FrameAnalyzer } from '../src/index.js';
import { capture, monochrome } from './engine.fixture';
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
