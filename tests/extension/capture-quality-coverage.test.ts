import { describe, expect, it } from 'vitest';

import {
  CaptureCoverage,
  withCaptureCoverage,
} from '../../apps/chrome-extension/src/capture-quality';
import { measurement } from './capture-quality.fixture';
describe('decoded frame coverage of the complete capture window', () => {
  it('does not let a short 60 fps burst hide a long silent tail', () => {
    const coverage = new CaptureCoverage(100);
    for (let frame = 0; frame <= 72; frame++)
      coverage.frameSubmitted(100 + (frame * 1000) / 60);
    const result = withCaptureCoverage(measurement(), coverage.finish(15100));
    expect(result.status).toBe('INCONCLUSIVE');
    expect(result.quality).toMatchObject({
      captureWindowMs: 15000,
      leadingIdleMs: 0,
      trailingIdleMs: 13800,
      frameCount: 73,
      effectiveFps: 60,
      interrupted: true,
    });
    expect(result.limitations.join(' ')).toContain(
      'Static source suppression and capture loss cannot be distinguished',
    );
  });

  it('exposes delayed first-frame timing without moving candidate timestamps', () => {
    const coverage = new CaptureCoverage(100);
    coverage.frameSubmitted(1100);
    coverage.frameSubmitted(2100);
    const original = measurement();
    const result = withCaptureCoverage(original, coverage.finish(2110));
    expect(result.quality.leadingIdleMs).toBe(1000);
    expect(result.quality.trailingIdleMs).toBe(10);
    expect(result.limitations.join(' ')).toContain(
      'relative to the first analyzed decoded frame, not the scenario start',
    );
    expect(original.quality.interrupted).toBe(false);
    expect(original.limitations).toEqual([]);
  });

  it('distinguishes no submitted frames from a complete short boundary gap', () => {
    const empty = withCaptureCoverage(
      measurement(),
      new CaptureCoverage(0).finish(15000),
    );
    expect(empty.quality).toMatchObject({
      captureWindowMs: 15000,
      leadingIdleMs: 15000,
      trailingIdleMs: 15000,
      interrupted: true,
    });
    expect(empty.limitations[0]).toContain('No decoded source frame');

    const coverage = new CaptureCoverage(0);
    for (let frame = 0; frame <= 72; frame++)
      coverage.frameSubmitted(100 + (frame * 1000) / 60);
    const complete = withCaptureCoverage(measurement(), coverage.finish(1400));
    expect(complete.status).toBe('NO_ISSUES_OBSERVED');
    expect(complete.quality.interrupted).toBe(false);
    expect(complete.quality.frameCount).toBe(73);
  });
});
