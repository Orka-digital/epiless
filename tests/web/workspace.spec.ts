import { test, expect } from '@playwright/test';

test('website launcher opens the target without claiming that a scan has started', async ({
  page,
  context,
  baseURL,
}) => {
  await page.goto('/');
  const input = page.getByLabel('Welke website wil je onderzoeken?');
  await input.fill('javascript://example.com/');
  await page.getByRole('button', { name: 'Website openen' }).click();
  await expect(input).toHaveJSProperty(
    'validationMessage',
    'Vul een geldige website in, bijvoorbeeld https://voorbeeld.be.',
  );
  expect(context.pages()).toHaveLength(1);
  await expect(page.locator('#launch-feedback')).toBeHidden();
  await input.fill(`${baseURL}/voorbeeld`);
  const opened = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Website openen' }).click();
  const target = await opened;
  await target.waitForURL(
    (url) =>
      url.origin === new URL(baseURL!).origin &&
      url.pathname.replace(/\/$/, '') === '/voorbeeld',
  );
  expect(await target.evaluate(() => window.opener)).toBeNull();
  await expect(
    page.getByText('Start de scan in de geopende tab.'),
  ).toBeVisible();
  await expect(page.locator('#launch-feedback')).toContainText(
    'Scan deze website',
  );
  await target.close();
});

test('the workspace distinguishes an empty index from an unavailable index', async ({
  page,
}) => {
  await page.route('**/api/index', (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Nog geen openbare rapporten' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Website openen' }),
  ).toBeEnabled();
  await page.unroute('**/api/index');
  await page.route('**/api/index', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable' } }),
  );
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'De index is even niet beschikbaar.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Open index', exact: true }),
  ).toHaveAttribute('href', '/sites');
  await expect(
    page.getByRole('button', { name: 'Website openen' }),
  ).toBeEnabled();
});
