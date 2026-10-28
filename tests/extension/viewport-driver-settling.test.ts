import { describe, expect, it, vi } from 'vitest';

import {
  clearEmulatedViewport,
  emulateCapturedViewport,
  waitForStableViewport,
} from '../../apps/chrome-extension/src/viewport-driver';

import { expected, fixture, original } from './viewport-driver.fixture';
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
});
