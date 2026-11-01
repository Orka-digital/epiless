import { expect, type BrowserContext, type Page } from '@playwright/test';

export async function openReportDetails(page: Page) {
  // Document order opens outer route disclosures before nested measurement,
  // diagnosis, sample and source-limit disclosures. No page script is required.
  const disclosures = page.locator('main details');
  for (let index = 0; index < (await disclosures.count()); index++) {
    const disclosure = disclosures.nth(index);
    if ((await disclosure.getAttribute('open')) === null)
      await disclosure.locator(':scope > summary').click();
    await expect(disclosure).toHaveAttribute('open', '');
  }
}

export async function createAccount(context: BrowserContext, origin: string) {
  const network = `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`;
  await context.setExtraHTTPHeaders({
    'CF-Connecting-IP': network,
    'X-Forwarded-For': network,
  });
  const challengeResponse = await context.request.post(
    '/api/security/challenge',
    {
      headers: { Origin: origin },
      data: { action: 'auth' },
    },
  );
  expect(challengeResponse.ok(), await challengeResponse.text()).toBe(true);
  const challenge = await challengeResponse.json();
  const signup = await context.request.post('/api/auth/sign-up/email', {
    headers: {
      Origin: origin,
      'x-flashguard-challenge': challenge.id,
      'x-captcha-response': 'flashguard-local-test',
    },
    data: {
      name: 'Diagnostic Test Contributor',
      email: `diagnostic-${crypto.randomUUID()}@example.net`,
      password: 'Diagnostic-test-account-2026!',
    },
  });
  expect(signup.ok(), await signup.text()).toBe(true);
}
