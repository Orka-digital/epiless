import { test as base } from '@playwright/test';

// Fixtures are reusable across spec files; an imported beforeEach hook is only
// registered in the first file that loads its module in a reused worker.
export const test = base.extend({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, use) => {
    // Keep the real limiter enabled with one independent network actor per test.
    const network = `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`;
    await use({
      ...extraHTTPHeaders,
      'CF-Connecting-IP': network,
      'X-Forwarded-For': network,
    });
  },
});
