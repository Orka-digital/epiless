import { describe, expect, it } from 'vitest';

import { FrameAnalyzer } from '../src/index.js';

import { field, rgbaImage } from './spatial.fixture';
describe('native detail and exact temporal state sharing', () => {
  it('retains a later simultaneous field maximum while first detection and source events keep their original time', () => {
    const firstDetections: ReturnType<FrameAnalyzer['finish']>['findings'] = [];
    const a = new FrameAnalyzer({
      visualField: { ...field, widthPx: 4, heightPx: 3 },
      onCandidate: (finding) => firstDetections.push(finding),
    });
    let left = 0,
      right = 0;
    for (let t = 0; t <= 1200; t += 25) {
      if (t >= 100 && t <= 700 && t % 100 === 0) left = 255 - left;
      if (t >= 150 && t <= 750 && t % 100 === 50) right = 255 - right;
      // Both already-reported components now transition on the same frame.
      if (t === 850) {
        left = 255 - left;
        right = 255 - right;
      }
      a.pushFrame({
        rgba: rgbaImage(4, 3, (x, y) =>
          y < 2 && x === 0 ? left : y < 2 && x === 3 ? right : 100,
        ),
        width: 4,
        height: 3,
        timestampMs: t,
      });
    }
    expect(firstDetections).toHaveLength(2);
    expect(firstDetections.map((f) => f.spatial!.sampledAtMs)).toEqual([
      700, 750,
    ]);
    for (const first of firstDetections)
      expect(first.spatial).toMatchObject({
        simultaneousPixels: 2,
        visualField: { maximumPixels: 2, exceedsThreshold: false },
      });
    const findings = a.finish().findings;
    expect(findings).toHaveLength(2);
    for (const [i, finding] of findings.entries()) {
      expect(finding.endMs).toBe(850);
      expect(finding.diagnostic).toEqual(firstDetections[i]!.diagnostic);
      expect(finding.spatial).toMatchObject({
        sampledAtMs: 850,
        componentPixels: 2,
        simultaneousPixels: 4,
        simultaneousRatio: 4 / 12,
        visualField: {
          maximumPixels: 4,
          maximumRatio: 4 / 12,
          exceedsThreshold: true,
        },
      });
    }
  });

  it('does not attach a calibrated field after rescaling and clears history on source changes', () => {
    const a = new FrameAnalyzer({ visualField: field });
    for (let t = 0; t <= 1200; t += 20)
      a.pushFrame({
        rgba: rgbaImage(20, 10, () => (Math.floor(t / 100) % 2 ? 255 : 0)),
        width: 20,
        height: 10,
        sourceWidth: 40,
        sourceHeight: 20,
        timestampMs: t,
      });
    const result = a.finish();
    expect(result.status).toBe('INCONCLUSIVE');
    expect(result.findings[0].spatial!.visualField).toBeUndefined();
  });
});
