// Browser codec preflight only: no extension, tab capture or performance claim.
// Usage: node tests/extension/preflight-native-encoded.mjs [asset-directory] [evidence.json]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { nativeCandidatePage } from './native-candidate-page.mjs';
import {
  encodedPageSource,
  loadNativeEncodedAssets,
  serveEncodedAsset,
  sha256,
} from './native-encoded-source.mjs';

assert.ok(process.argv.length <= 4);
const assets = await loadNativeEncodedAssets(process.argv[2]);
const server = createServer((request, response) => {
  const asset = Object.values(assets.assets).find(
    (value) => request.url === `/__native-encoded/${value.record.file}`,
  );
  if (asset) return serveEncodedAsset(request, response, asset.bytes);
  if (!['/signal', '/fixed'].includes(request.url)) {
    response.writeHead(404);
    response.end();
    return;
  }
  const fixed = request.url === '/fixed';
  response.setHeader('Content-Type', 'text/html');
  response.end(
    nativeCandidatePage({ fixed, encoded: encodedPageSource(assets, fixed) }),
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 900, height: 650 },
    deviceScaleFactor: 2,
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  const results = [];
  for (const name of ['signal', 'fixed']) {
    await page.goto(`http://127.0.0.1:${server.address().port}/${name}`);
    await page.waitForFunction(
      () => document.querySelector('video').readyState >= 1,
    );
    const before = await page.evaluate(() => {
      const video = document.querySelector('video');
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 2;
      const context = canvas.getContext('2d', {
        alpha: false,
        colorSpace: 'srgb',
        willReadFrequently: true,
      });
      window.__encodedIndependent = [];
      const record = (callbackTime, metadata) => {
        context.drawImage(video, 0, 0, 2, 2);
        window.__encodedIndependent.push({
          callbackEpochMs: performance.timeOrigin + callbackTime,
          presentationEpochMs:
            performance.timeOrigin + metadata.presentationTime,
          expectedDisplayEpochMs:
            performance.timeOrigin + metadata.expectedDisplayTime,
          mediaTime: metadata.mediaTime,
          presentedFrames: metadata.presentedFrames,
          rgba: [...context.getImageData(0, 0, 2, 2).data],
        });
        if (window.__encodedIndependent.length < 100)
          video.requestVideoFrameCallback(record);
      };
      video.requestVideoFrameCallback(record);
      const rect = video.getBoundingClientRect();
      return {
        paused: video.paused,
        currentTime: video.currentTime,
        preload: video.preload,
        poster: video.poster,
        srcObject: video.srcObject,
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        events: window.__nativeCandidateFixture.events,
      };
    });
    assert.equal(before.paused, true);
    assert.equal(before.currentTime, 0);
    assert.equal(before.preload, 'metadata');
    assert.match(before.poster, /^data:image\/svg\+xml,/);
    assert.equal(before.srcObject, null);
    assert.equal(before.width, 2);
    assert.equal(before.height, 2);
    assert.deepEqual(before.rect, { x: 100, y: 240, width: 2, height: 2 });
    assert.equal(
      before.events.some((value) => value.kind === 'ENCODED_PLAYING'),
      false,
    );
    await page.getByRole('button', { name: 'Toon details' }).click();
    await page.waitForFunction(() => document.querySelector('video').ended);
    const state = await page.evaluate(() => ({
      independent: window.__encodedIndependent,
      fixture: window.__nativeCandidateFixture,
    }));
    assert.ok(
      state.independent.length >= 50,
      `Expected 50+ actual presented frames for ${name}.`,
    );
    assert.ok(
      !state.fixture.events.some((value) =>
        [
          'MEDIA_ERROR',
          'RVFC_UNAVAILABLE',
          'ENCODED_TIMESTAMP_UNMATCHED',
        ].includes(value.kind),
      ),
    );
    const seen = new Set();
    for (const sample of state.independent) {
      const index = Math.round(sample.mediaTime * 25);
      const expected = assets.assets[name].record.frames[index];
      assert.ok(expected);
      assert.ok(Math.abs(sample.mediaTime * 1000 - expected.timestampMs) < 0.1);
      assert.equal(
        sha256(Buffer.from(sample.rgba)),
        expected.rgbaSha256,
        `Browser video RGB mismatch in ${name} frame ${index}.`,
      );
      seen.add(index);
      sample.sourceFrameIndex = index;
      sample.rgbaSha256 = sha256(Buffer.from(sample.rgba));
    }
    assert.ok(seen.size >= 50);
    assert.ok(seen.has(52), 'Final baseline frame must be actually presented.');
    results.push({
      name,
      sourceSha256: assets.assets[name].record.sha256,
      before,
      presentedFrames: state.independent.length,
      distinctSourceFrames: seen.size,
      maximumDecodedRgbError: 0,
      independent: state.independent,
      events: state.fixture.events,
    });
  }
  assert.deepEqual(errors, []);
  const result = {
    status: 'PASS',
    scope:
      'Headless browser decoding/presentation of two 2×2 encoded VP9/WebM sources, with independent per-rVFC 2×2 RGB readback. No extension or native tab capture, no full-frame flashing, no cadence-performance or physical colour claim.',
    browser: browser.version(),
    sourceManifestSha256: assets.manifestSha256,
    results,
  };
  if (process.argv[3])
    await writeFile(process.argv[3], JSON.stringify(result, null, 2) + '\n', {
      flag: 'wx',
    });
  console.log(
    JSON.stringify(
      { ...result, results: results.map(({ independent, ...value }) => value) },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
