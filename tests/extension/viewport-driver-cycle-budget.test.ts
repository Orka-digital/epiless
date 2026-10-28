import { describe, expect, it, vi } from 'vitest';

import { waitForStableViewport } from '../../apps/chrome-extension/src/viewport-driver';

import { original } from './viewport-driver.fixture';
describe('terminal rebind eligibility', () => {
  it.each(['read', 'guard'] as const)(
    'does not treat an expired %s operation as observed geometry mismatch',
    async (hung) => {
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'performance'],
      });
      try {
        let reads = 0,
          guards = 0;
        const result = waitForStableViewport({
          expected: original,
          timeoutMs: 7000,
          reserveCycleMs: 100,
          read: async () => {
            if (++reads > 3 && hung === 'read') return new Promise(() => {});
            return { ...original, height: 450 };
          },
          guard: async () => {
            if (++guards > 6 && hung === 'guard') return new Promise(() => {});
          },
          wait: async (ms) => {
            await new Promise((resolve) => setTimeout(resolve, ms));
          },
        }).catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(7000);
        expect(await result).toMatchObject({
          canRebind: false,
          lastMatchedExpected: false,
        });
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('permits only repeated valid measured mismatches, preserving invalid or missing evidence as failure', async () => {
    const wait = async () => {};
    for (const height of [450, NaN, 0]) {
      const error = await waitForStableViewport({
        expected: original,
        read: async () => ({ ...original, height }),
        wait,
      }).catch((value: unknown) => value);
      expect(error).toMatchObject({ canRebind: height === 450 });
    }
  });

  it.each([
    [undefined, false, 67, 133],
    [0, false, 67, 133],
    [100, true, 66, 132],
  ] as const)(
    'with a %s ms cycle reserve preserves completed mismatch evidence without starting an unfinishable context cycle',
    async (reserveCycleMs, canRebind, reads, guards) => {
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'performance'],
      });
      try {
        const delay = (ms: number) =>
          new Promise<void>((resolve) => setTimeout(resolve, ms));
        const guard = vi.fn(async () => {
          await delay(1);
        });
        const read = vi.fn(async () => {
          await delay(4);
          return { ...original, height: 450 };
        });
        const wait = vi.fn(delay);
        const result = waitForStableViewport({
          read,
          guard,
          wait,
          expected: original,
          timeoutMs: 7000,
          reserveCycleMs,
        }).catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(7005);
        expect(await result).toMatchObject({
          canRebind,
          lastMatchedExpected: false,
        });
        expect(read).toHaveBeenCalledTimes(reads);
        expect(guard).toHaveBeenCalledTimes(guards);
        expect(wait).toHaveBeenCalledTimes(66);
        await vi.advanceTimersByTimeAsync(100);
        expect(read).toHaveBeenCalledTimes(reads);
        expect(guard).toHaveBeenCalledTimes(guards);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('does not rebind when the last two verified samples already match and the reserved cycle budget ends', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'performance'],
    });
    try {
      const delay = (ms: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, ms));
      const guard = vi.fn(async () => {
        await delay(1);
      });
      let samples = 0;
      const read = vi.fn(async () => {
        await delay(4);
        return ++samples <= 64 ? { ...original, height: 450 } : { ...original };
      });
      const result = waitForStableViewport({
        read,
        guard,
        wait: delay,
        expected: original,
        timeoutMs: 7000,
        reserveCycleMs: 100,
      }).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(7000);
      expect(await result).toMatchObject({
        canRebind: false,
        lastMatchedExpected: true,
      });
      expect(read).toHaveBeenCalledTimes(66);
      expect(guard).toHaveBeenCalledTimes(132);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a non-integer or out-of-range cycle reserve before starting context reads', async () => {
    const read = vi.fn(async () => original);
    const guard = vi.fn(async () => {});
    const wait = vi.fn(async () => {});
    for (const reserveCycleMs of [-1, 101, 0.5, Infinity, NaN]) {
      await expect(
        waitForStableViewport({
          read,
          guard,
          wait,
          expected: original,
          reserveCycleMs,
        }),
      ).rejects.toThrow(/OUTSIDE_BOUNDS/);
    }
    expect(read).not.toHaveBeenCalled();
    expect(guard).not.toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
  });
});
