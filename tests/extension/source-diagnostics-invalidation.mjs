import assert from 'node:assert/strict';
/** Exercise stale document, viewport, scroll and malformed-region rejection without page activation. */
export async function testDiagnosticInvalidation(
  page,
  diagnose,
  expected,
  request,
  getContext,
) {
  for (const invalid of [
    { x: -1, y: 0, width: 20, height: 20 },
    { x: 0, y: 0, width: 321, height: 20 },
    { x: 0, y: 0, width: 20, height: 241 },
    { x: 0, y: 0, width: 0, height: 20 },
    { x: 0, y: 0, height: 20 },
  ]) {
    const result = await diagnose({ region: invalid });
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.sampledPoints, 0);
    assert.deepEqual(result.candidates, []);
  }
  assert.equal(
    (await diagnose({ analysis: { width: 320, height: 180 } })).reason,
    'CAPTURE_ASPECT_RATIO_MISMATCH',
  );
  assert.equal(
    (await diagnose({ expected: { ...expected, documentToken: 'stale' } }))
      .reason,
    'DOCUMENT_CHANGED',
  );
  assert.equal(
    (
      await diagnose({
        expected: { ...expected, viewport: { ...expected.viewport, dpr: 2 } },
      })
    ).reason,
    'VIEWPORT_CHANGED',
  );
  assert.equal(
    (
      await diagnose({
        expected: {
          ...expected,
          viewport: { ...expected.viewport, visualScale: 2 },
        },
      })
    ).reason,
    'VIEWPORT_CHANGED',
  );
  assert.equal(
    (
      await diagnose({
        expected: {
          ...expected,
          viewport: { ...expected.viewport, scrollX: 10 },
        },
      })
    ).reason,
    'SCROLL_CHANGED',
  );
  await page.setViewportSize({ width: 900, height: 600 });
  assert.equal((await diagnose()).reason, 'VIEWPORT_CHANGED');
  await page.setViewportSize({ width: 800, height: 600 });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  assert.equal(
    (await diagnose()).reason,
    'VIEWPORT_CHANGED',
    'Restoring the old dimensions must not revive stale geometry',
  );
  request.expected = await getContext();
  await page.evaluate(() => scrollTo(0, 100));
  await page.waitForFunction(() => scrollY === 100);
  assert.equal((await diagnose()).reason, 'SCROLL_CHANGED');
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForFunction(() => scrollY === 0);
  await page.evaluate(() =>
    history.replaceState({}, '', '?different-private-query'),
  );
  assert.equal(
    (await diagnose()).reason,
    'DOCUMENT_CHANGED',
    'Query changes cannot be silently attributed to earlier state',
  );
  await page.evaluate(() =>
    history.replaceState({}, '', '?private-query#private-fragment'),
  );
  assert.equal(
    await page.evaluate(() => window.diagnosticClicks),
    0,
    'Diagnostics perform no page activation',
  );
}
