import { vi } from 'vitest';

import type { PageInventory } from '../../apps/chrome-extension/src/model';

export const original = { width: 1200, height: 800, dpr: 2 };

export const expected = { width: 600, height: 400, dpr: 2 };

export function fixture(
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
