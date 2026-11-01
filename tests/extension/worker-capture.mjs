import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { assertWorkerCapture } from './worker-capture-assertions.mjs';
import { captureWorkerScenario } from './worker-capture-scenario.mjs';

const { buildReport } = await tsImport(
  '../../apps/chrome-extension/src/report.ts',
  import.meta.url,
);

// Real Chrome WebCodecs in a worker, using only unrendered numeric RGBA/BGRA
// buffers. No tabCapture authority and no visible flashing fixture. This tests
// conversion/order/metadata; the toolbar native fixture remains a separate gate.
const require = createRequire(
  new URL('../../apps/chrome-extension/package.json', import.meta.url),
);
const { build } = require('esbuild');
const buildOptions = {
  entryPoints: [
    new URL(
      '../../apps/chrome-extension/src/analysis-worker.ts',
      import.meta.url,
    ).pathname,
  ],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
};
const enginePath = fileURLToPath(
  new URL('../../packages/analysis-engine/src/index.ts', import.meta.url),
);
// Test-only dependency substitution. The production worker protocol has no
// backend flag, and both bundles retain the real converter/worker/engine code.
const forceJavaScript = {
  name: 'force-js-engine-for-differential',
  setup(builder) {
    builder.onResolve({ filter: /^@epi-less\/analysis-engine$/ }, () => ({
      path: 'engine',
      namespace: 'forced-js-engine',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'forced-js-engine' }, () => ({
      contents: `
        export * from ${JSON.stringify(enginePath)};
        import { FrameAnalyzer as Original } from ${JSON.stringify(enginePath)};
        export class FrameAnalyzer extends Original {
          constructor(options = {}) { super({ ...options, backend: 'JS' }); }
        }
      `,
      loader: 'ts',
      resolveDir: fileURLToPath(new URL('.', import.meta.url)),
    }));
  },
};
const [compiled, compiledJavaScript] = await Promise.all([
  build(buildOptions),
  build({ ...buildOptions, plugins: [forceJavaScript] }),
]);
const sources = new Map([
  ['/worker.js', compiled.outputFiles[0].text],
  ['/worker-js.js', compiledJavaScript.outputFiles[0].text],
]);
const server = http.createServer((req, res) => {
  res.setHeader(
    'Content-Type',
    sources.has(req.url) ? 'text/javascript' : 'text/html',
  );
  res.end(
    sources.get(req.url) ??
      '<!doctype html><title>Numeric worker verification</title><p>Static verification page. Pixel buffers are not rendered.</p>',
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const denseReports = new Map();
  for (const scenario of [
    { format: 'RGBA', width: 16, height: 16 },
    { format: 'BGRA', width: 16, height: 16 },
    { format: 'RGBA', width: 640, height: 360, disjoint: true },
    { format: 'RGBA', width: 1280, height: 720, disjoint: true, dpr: 2 },
    { format: 'RGBA', width: 16, height: 16, pageZoom: 2 },
    { format: 'RGBA', width: 16, height: 16, missingMapping: true },
    {
      format: 'RGBA',
      width: 640,
      height: 360,
      disjoint: true,
      rescaledTransfer: true,
    },
    { format: 'RGBA', width: 128, height: 96, dense: true },
    {
      format: 'RGBA',
      width: 128,
      height: 96,
      dense: true,
      forceJavaScript: true,
    },
    {
      format: 'RGBA',
      width: 128,
      height: 96,
      dense: true,
      rgbaTransfer: true,
    },
    {
      format: 'RGBA',
      width: 128,
      height: 96,
      dense: true,
      rgbaTransfer: true,
      forceJavaScript: true,
    },
  ]) {
    const report = await page.evaluate(captureWorkerScenario, scenario);
    assertWorkerCapture(report, scenario, denseReports);
    const startedAt = '2026-10-27T10:00:00.000Z',
      endedAt = '2026-10-27T10:00:02.000Z';
    const exported = JSON.parse(
      JSON.stringify(
        buildReport({
          id: 'worker-spatial-contract',
          engineVersion: '0.4.0-candidate',
          tabId: 1,
          origin: 'https://example.com',
          startUrl: 'https://example.com/',
          startedAt,
          updatedAt: endedAt,
          endedAt,
          state: 'COMPLETED',
          stopIntent: false,
          generation: 'numeric-worker-test',
          elapsedMs: 2000,
          tasks: [
            {
              id: 'route',
              url: 'https://example.com/',
              depth: 0,
              state: 'OBSERVED',
              reasons: [],
              observations: [
                {
                  id: 'measurement',
                  scenario: 'initial',
                  startedAt,
                  endedAt,
                  achieved: true,
                  measurement: report.result,
                },
              ],
            },
          ],
          skippedLinks: 0,
          limitations: [],
          mode: 'QUICK',
          limits: {
            maxRoutes: 1,
            maxDepth: 0,
            maxDurationMs: 2000,
            maxActionsPerRoute: 0,
          },
        }),
      ),
    );
    assert.deepEqual(
      exported.routes[0].scenarios[0].findings.map((f) => f.spatial),
      report.result.findings.map((f) => f.spatial),
    );
    assert.equal(exported.passed, null);
    assert.deepEqual(
      exported.routes[0].scenarios[0].quality.processing.analysisBackend,
      report.result.quality.processing.analysisBackend,
    );
  }
  console.log(
    'Chrome worker capture passed: 7 existing conversion/reference scenarios plus dense VideoFrame and RGBA-transfer WASM/forced-JS pairs; exact findings/live events/non-performance quality, direct copyTo without a second frame copy, accounted transfer copies, FIFO draining and schema-validated backend evidence. No frames rendered; this is not tabCapture/CSP/native-performance proof.',
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
