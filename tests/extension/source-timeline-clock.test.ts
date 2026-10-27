import { describe, expect, it } from 'vitest';
import { SourceFrameClock } from '../../apps/chrome-extension/src/source-timeline-clock';

describe('source frame receipt clock', () => {
  it('uses each boundary frame receipt rather than assuming constant delivery offset', () => {
    const clock = new SourceFrameClock();
    const sourceOrigin = 4_813_607_957,
      epoch = 1_798_536_000_000;
    for (let i = 0; i < 60; i++)
      clock.add(sourceOrigin + i * 16, epoch + i * 16 + (i >= 30 ? 25 : 0));
    const result = clock.resolve(sourceOrigin + 160, sourceOrigin + 800)!;
    expect(result).toMatchObject({
      windowStartEpochMs: epoch + 160,
      windowEndEpochMs: epoch + 825,
      alignmentUncertaintyMs: null,
      frameClock: {
        matchedFrames: 41,
        receiptOffsetSpreadMs: 25,
        startBoundaryErrorMs: 0,
        endBoundaryErrorMs: 0,
      },
    });
    expect(JSON.stringify(result)).not.toContain(String(sourceOrigin));
  });

  it('does not fabricate clocks over missing frames, restarts or long delayed delivery', () => {
    const clock = new SourceFrameClock();
    expect(clock.resolve(0, 100)).toBeUndefined();
    expect(clock.add(0, 1000)).toBe(true);
    expect(clock.add(0, 1001)).toBe(false);
    expect(clock.add(10, 999)).toBe(false);
    expect(clock.add(NaN, 1000)).toBe(false);
    clock.add(500, 1500);
    expect(clock.resolve(200, 500)).toBeUndefined();
    expect(clock.resolve(500, 0)).toBeUndefined();
    clock.add(600, 4000);
    expect(clock.resolve(0, 600)).toBeUndefined();
    clock.reset();
    expect(clock.resolve(500, 600)).toBeUndefined();
    expect(clock.add(0, 5000)).toBe(true);
  });

  it('bounds retention and exposes nearest-frame error without claiming latency precision', () => {
    const clock = new SourceFrameClock();
    for (let i = 0; i < 2000; i++) clock.add(i * 16, 100_000 + i * 16);
    expect(clock.resolve(0, 100)).toBeUndefined();
    const result = clock.resolve(31_000, 31_500)!;
    expect(result.frameClock.startBoundaryErrorMs).toBe(8);
    expect(result.frameClock.endBoundaryErrorMs).toBe(4);
    expect(result.frameClock.matchedFrames).toBeLessThanOrEqual(360);
    expect(result.alignmentUncertaintyMs).toBeNull();
  });
});
