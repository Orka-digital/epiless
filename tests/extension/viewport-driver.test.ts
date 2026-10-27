import { describe, expect, it, vi } from 'vitest';
import {
  clearEmulatedViewport,
  emulateCapturedViewport,
  restoreEmulatedViewport,
  waitForStableViewport,
} from '../../apps/chrome-extension/src/viewport-driver';
import type { PageInventory } from '../../apps/chrome-extension/src/model';

const original = { width: 1200, height: 800, dpr: 2 };
const expected = { width: 600, height: 400, dpr: 2 };
function fixture(
  overrides: {
    viewport?: typeof expected;
    visual?: Record<string, number>;
  } = {},
) {
  const before = {
    url: 'https://example.test/',
    viewport: original,
  } as PageInventory;
  const reached = { ...before, viewport: overrides.viewport ?? expected };
  const command = vi.fn(async (_tabId: number, method: string) =>
    method === 'Page.getLayoutMetrics'
      ? {
          cssVisualViewport: {
            clientWidth: 600,
            clientHeight: 400,
            scale: 1,
            offsetX: 0,
            offsetY: 0,
            ...overrides.visual,
          },
        }
      : {},
  );
  return {
    tabId: 3,
    expected,
    driver: { command },
    read: vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(reached),
    guard: vi.fn(async () => undefined),
    wait: vi.fn(async () => undefined),
    remember: vi.fn(),
  };
}
describe('responsive viewport driver', () => {
  it('waits for stable actual geometry through browser-chrome and restoration transitions', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ width: 900, height: 507, dpr: 2 })
      .mockResolvedValueOnce({ width: 900, height: 465, dpr: 2 })
      .mockResolvedValue({ width: 900, height: 450, dpr: 2 });
    const wait = vi.fn(async () => {});
    expect(await waitForStableViewport({ read, wait })).toEqual({
      width: 900,
      height: 450,
      dpr: 2,
    });
    expect(read).toHaveBeenCalledTimes(5);
    expect(wait).toHaveBeenCalledTimes(4);
    const restore = vi
      .fn()
      .mockResolvedValueOnce({ width: 600, height: 450, dpr: 2 })
      .mockResolvedValueOnce({ width: 700, height: 450, dpr: 2 })
      .mockResolvedValue({ width: 900, height: 450, dpr: 2 });
    expect(
      await waitForStableViewport({
        read: restore,
        wait,
        expected: { width: 900, height: 450, dpr: 2 },
      }),
    ).toEqual({ width: 900, height: 450, dpr: 2 });
  });
  it('does not accept a stable wrong restoration or continue after cancellation', async () => {
    const read = vi.fn(async () => ({ width: 900, height: 450, dpr: 2 }));
    const wait = vi.fn(async () => {});
    await expect(
      waitForStableViewport({
        read,
        wait,
        expected: { width: 900, height: 507, dpr: 2 },
      }),
    ).rejects.toThrow('VIEWPORT_RESTORE_GEOMETRY_UNCONFIRMED');
    expect(read).toHaveBeenCalledTimes(30);
    read.mockClear();
    await expect(
      waitForStableViewport({
        read,
        wait,
        guard: async () => {
          throw new Error('RUNNER_CANCELLED');
        },
      }),
    ).rejects.toThrow('RUNNER_CANCELLED');
    expect(read).not.toHaveBeenCalled();
  });
  it('bounds slow reads by a monotonic deadline and ignores a late matching result', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      let resolveRead!: (value: typeof original) => void;
      const read = vi.fn(
        () =>
          new Promise<typeof original>((resolve) => {
            resolveRead = resolve;
          }),
      );
      const guard = vi.fn(async () => {}),
        wait = vi.fn(async () => {});
      const result = expect(
        waitForStableViewport({ read, wait, guard, expected: original }),
      ).rejects.toThrow('VIEWPORT_RESTORE_GEOMETRY_UNCONFIRMED');
      await vi.advanceTimersByTimeAsync(3000);
      await result;
      expect(read).toHaveBeenCalledOnce();
      expect(guard).toHaveBeenCalledOnce();
      resolveRead(original);
      await Promise.resolve();
      await Promise.resolve();
      expect(read).toHaveBeenCalledOnce();
      expect(guard).toHaveBeenCalledOnce();
      expect(wait).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it('counts browser-read overhead in the same budget and cannot accept three matching but late samples', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      const read = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1100));
        return original;
      });
      const wait = async (ms: number) => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      };
      const result = expect(
        waitForStableViewport({ read, wait, expected: original }),
      ).rejects.toThrow('VIEWPORT_RESTORE_GEOMETRY_UNCONFIRMED');
      await vi.advanceTimersByTimeAsync(3000);
      await result;
      expect(read).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1000);
      expect(read).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
  it('caps samples even if a wait mock resolves without advancing time, and rejects unbounded budgets', async () => {
    const read = vi.fn(async () => ({ ...original, height: 1 }));
    const wait = vi.fn(async () => {});
    await expect(
      waitForStableViewport({
        read,
        wait,
        expected: original,
        timeoutMs: 7000,
      }),
    ).rejects.toThrow('VIEWPORT_RESTORE_GEOMETRY_UNCONFIRMED');
    expect(read).toHaveBeenCalledTimes(70);
    for (const timeoutMs of [0, -1, 7001, Infinity, NaN])
      await expect(
        waitForStableViewport({ read, wait, timeoutMs }),
      ).rejects.toThrow('VIEWPORT_SETTLE_TIMEOUT_OUTSIDE_BOUNDS');
    expect(read).toHaveBeenCalledTimes(70);
  });
  it('changes desktop CSS metrics without resizing the browser widget, retaining original geometry for cleanup verification', async () => {
    const input = fixture();
    expect((await emulateCapturedViewport(input)).viewport).toEqual(expected);
    expect(input.remember).toHaveBeenCalledWith(original);
    expect(input.driver.command).toHaveBeenNthCalledWith(
      1,
      3,
      'Emulation.setDeviceMetricsOverride',
      {
        width: 600,
        height: 400,
        deviceScaleFactor: 2,
        mobile: false,
        scale: 1,
        dontSetVisibleSize: true,
      },
    );
    await clearEmulatedViewport(3, input.driver);
    expect(input.driver.command).toHaveBeenLastCalledWith(
      3,
      'Emulation.clearDeviceMetricsOverride',
    );
  });
  it.each([
    { viewport: { ...expected, width: 599 } },
    { viewport: { ...expected, dpr: 1 } },
    { visual: { scale: 1.2 } },
    { visual: { offsetX: 1 } },
    { visual: { clientWidth: 300 } },
    { visual: { clientHeight: 401 } },
  ])('refuses an unverified CSS or visual viewport: %j', async (override) => {
    await expect(emulateCapturedViewport(fixture(override))).rejects.toThrow(
      'CDP_VIEWPORT_GEOMETRY_NOT_CONFIRMED',
    );
  });
  it('allows the limited client extent consumed by a normal scrollbar', async () => {
    await expect(
      emulateCapturedViewport(fixture({ visual: { clientWidth: 585 } })),
    ).resolves.toBeDefined();
  });
  it('never changes geometry after a stop guard or mismatched device scale', async () => {
    const stopped = fixture();
    stopped.guard.mockRejectedValueOnce(new Error('STOPPED'));
    await expect(emulateCapturedViewport(stopped)).rejects.toThrow('STOPPED');
    expect(stopped.driver.command).not.toHaveBeenCalled();
    const scaled = fixture();
    scaled.expected = { ...expected, dpr: 1 };
    await expect(emulateCapturedViewport(scaled)).rejects.toThrow(
      'VIEWPORT_DPR_MISMATCH',
    );
    expect(scaled.driver.command).not.toHaveBeenCalled();
  });
  it('rejects unsupported dimensions before mutating the browser', async () => {
    const input = fixture();
    input.expected = { ...expected, width: 100 };
    await expect(emulateCapturedViewport(input)).rejects.toThrow(
      'CDP_VIEWPORT_OUTSIDE_SUPPORTED_BOUNDS',
    );
    expect(input.driver.command).not.toHaveBeenCalled();
  });
  it('clears metrics without leaving another visible-size override and reports a failed cleanup', async () => {
    const input = fixture();
    await restoreEmulatedViewport(3, original, input.driver);
    expect(input.driver.command).toHaveBeenCalledOnce();
    expect(input.driver.command).toHaveBeenLastCalledWith(
      3,
      'Emulation.clearDeviceMetricsOverride',
    );
    input.driver.command.mockRejectedValueOnce(new Error('TARGET_CHANGED'));
    await expect(
      restoreEmulatedViewport(3, original, input.driver),
    ).rejects.toThrow('TARGET_CHANGED');
    expect(input.driver.command).toHaveBeenLastCalledWith(
      3,
      'Emulation.clearDeviceMetricsOverride',
    );
  });
});

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
