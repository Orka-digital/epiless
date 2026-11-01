import { test } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  // Each test is an independent network actor; keep the real limiter enabled
  // without sharing the write quota with other accounts in the browser suite.
  const network = `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`;
  await context.setExtraHTTPHeaders({
    'CF-Connecting-IP': network,
    'X-Forwarded-For': network,
  });
});
