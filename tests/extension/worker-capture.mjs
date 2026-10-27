import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { tsImport } from 'tsx/esm/api';

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
  function comparableResult(result) {
    const normalized = structuredClone(result);
    // These are the only permitted differences between processing backends.
    // Preserve status, limitations, source cadence, complete findings and all
    // other quality/conversion metadata, including the real decoded geometry.
    delete normalized.quality.spatial.stateBytes;
    for (const name of [
      'meanMs',
      'maxMs',
      'framesOver16_7Ms',
      'conversionMeanMs',
      'analysisMeanMs',
      'analysisBackend',
    ])
      delete normalized.quality.processing[name];
    return normalized;
  }
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
    const report = await page.evaluate(async (scenario) => {
      const {
        format,
        width,
        height,
        disjoint,
        rescaledTransfer,
        dpr = 1,
        pageZoom = 1,
        missingMapping,
        dense,
        rgbaTransfer,
        forceJavaScript,
      } = scenario;
      const sourceWidth = rescaledTransfer ? width * 2 : width,
        sourceHeight = rescaledTransfer ? height * 2 : height;
      const worker = new Worker(
          forceJavaScript ? '/worker-js.js' : '/worker.js',
        ),
        events = [],
        liveEvents = [];
      let empty;
      let warmupEvents;
      let inFlight = 0,
        maximumInFlight = 0,
        completedFrames = 0;
      let nextFrame = 0,
        endQueued = false,
        pendingAtEnd = 0;
      let transferredFramesClosed = true;
      let fillQueue = () => {};
      let ready;
      const preparation = new Promise((resolve) => {
        ready = resolve;
      });
      const result = new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Worker timed out')),
          10000,
        );
        worker.onerror = (e) => {
          clearTimeout(timeout);
          reject(new Error(e.message));
        };
        worker.onmessage = (e) => {
          if (e.data.type === 'FRAME_DONE') {
            inFlight--;
            completedFrames++;
            fillQueue();
          }
          if (e.data.type === 'FRAME_ERROR' || e.data.ok === false) {
            clearTimeout(timeout);
            reject(new Error(e.data.error));
            return;
          }
          if (e.data.type === 'CANDIDATE_EVENT') {
            events.push(e.data.finding.id);
            liveEvents.push(e.data);
          }
          if (e.data.id === 'empty') {
            empty = e.data.value;
            warmupEvents = events.length;
            ready();
          }
          if (e.data.id === 'done') {
            clearTimeout(timeout);
            resolve({
              result: e.data.value,
              events,
              liveEvents,
              empty,
              warmupEvents,
              maximumInFlight,
              completedFrames,
              pendingAtEnd,
              transferredFramesClosed,
            });
          }
        };
      });
      worker.postMessage({
        type: 'BEGIN',
        id: 'prepare',
        sourceGeometry: { width: sourceWidth, height: sourceHeight },
        ...(missingMapping
          ? {}
          : {
              referenceMapping: {
                viewport: {
                  width: sourceWidth / dpr,
                  height: sourceHeight / dpr,
                  dpr,
                },
                pageZoom,
                visualScale: 1,
              },
            }),
      });
      worker.postMessage({ type: 'END', id: 'empty' });
      await Promise.race([preparation, result]);
      worker.postMessage({
        type: 'BEGIN',
        id: 'begin',
        sourceGeometry: { width: sourceWidth, height: sourceHeight },
        ...(missingMapping
          ? {}
          : {
              referenceMapping: {
                viewport: {
                  width: sourceWidth / dpr,
                  height: sourceHeight / dpr,
                  dpr,
                },
                pageZoom,
                visualScale: 1,
              },
            }),
      });
      // Match offscreen's bounded three-frame FIFO. END is sent while the last
      // frames are still pending, so ordered draining is actually exercised.
      fillQueue = () => {
        while (nextFrame < 76 && inFlight < 3) {
          const frame = nextFrame++;
          const rgba = new Uint8Array(width * height * 4),
            green = Math.floor(frame / 6) % 2 === 1;
          for (let i = 0; i < rgba.length; i += 4) {
            if (dense) {
              // Every pixel varies, with distinct tile histories and more
              // changed runs than a raw frame. The opposing red/green phases
              // produce real general/red candidates while per-frame low-level
              // variation ensures the dense kernel is genuinely exercised.
              const pixel = i / 4;
              let noise =
                Math.imul(pixel + 1, 0x45d9f3b) ^
                Math.imul(frame + 1, 0x27d4eb2d);
              noise = Math.imul(noise ^ (noise >>> 16), 0x45d9f3b) >>> 0;
              rgba[i] = (green ? 5 : 220) + (noise & 15);
              rgba[i + 1] = (green ? 220 : 5) + ((noise >>> 8) & 15);
              rgba[i + 2] = 8 + ((noise >>> 16) & 15);
            } else if (disjoint) {
              const x = ((i / 4) % width) / dpr,
                y = Math.floor(i / 4 / width) / dpr;
              // Each 100x120 rectangle is below 21824 pixels. Their 40-pixel
              // gap keeps them disconnected; one 341x256 field contains both.
              if (
                green &&
                y >= 30 &&
                y < 150 &&
                ((x >= 30 && x < 130) || (x >= 170 && x < 270))
              )
                rgba[i] = rgba[i + 1] = rgba[i + 2] = 255;
            } else {
              rgba[i + (format === 'RGBA' ? 0 : 2)] = green ? 0 : 255;
              rgba[i + 1] = green ? 255 : 0;
            }
            rgba[i + 3] = 255;
          }
          inFlight++;
          maximumInFlight = Math.max(maximumInFlight, inFlight);
          if (rescaledTransfer || rgbaTransfer) {
            // The existing fallback transports already converted/rescaled
            // RGBA with the original source extent. Exercise that worker path.
            worker.postMessage(
              {
                type: 'FRAME',
                buffer: rgba.buffer,
                width,
                height,
                sourceWidth,
                sourceHeight,
                timestampMs: (frame * 1000) / 60,
              },
              [rgba.buffer],
            );
            transferredFramesClosed &&= rgba.byteLength === 0;
          } else {
            const source = new VideoFrame(rgba, {
              format,
              codedWidth: width,
              codedHeight: height,
              timestamp: Math.round((frame * 1_000_000) / 60),
              colorSpace: {
                primaries: 'bt709',
                transfer: 'iec61966-2-1',
                matrix: 'rgb',
                fullRange: true,
              },
            });
            worker.postMessage(
              {
                type: 'FRAME',
                frame: source,
                sourceWidth,
                sourceHeight,
                timestampMs: (frame * 1000) / 60,
              },
              [source],
            );
            transferredFramesClosed &&= source.codedWidth === 0;
          }
        }
        if (nextFrame === 76 && !endQueued) {
          endQueued = true;
          pendingAtEnd = inFlight;
          worker.postMessage({ type: 'END', id: 'done' });
        }
      };
      fillQueue();
      try {
        return await result;
      } finally {
        worker.terminate();
      }
    }, scenario);
    assert.equal(report.result.quality.frameCount, 76);
    assert.equal(report.completedFrames, 76);
    assert.equal(report.maximumInFlight, 3);
    assert.equal(report.pendingAtEnd, 3);
    assert.equal(report.transferredFramesClosed, true);
    assert.equal(report.empty.quality.frameCount, 0);
    assert.equal(report.empty.quality.processing.measuredFrames, 0);
    assert.equal(report.empty.quality.processing.maxMs, 0);
    assert.equal(
      report.empty.quality.processing.analysisBackend.denseFrames,
      0,
    );
    assert.equal(
      report.empty.quality.processing.analysisBackend.inputCopiedBytes,
      0,
    );
    assert.deepEqual(report.empty.findings, []);
    assert.equal(report.warmupEvents, 0);
    assert.equal(
      report.result.quality.downsampled,
      scenario.rescaledTransfer === true,
    );
    assert.deepEqual(report.result.quality.processing.conversionMethods, [
      scenario.rescaledTransfer || scenario.rgbaTransfer
        ? 'RGBA_TRANSFER'
        : 'VIDEOFRAME_COPY_RGBA',
    ]);
    if (!scenario.rescaledTransfer && !scenario.rgbaTransfer) {
      assert.equal(
        report.result.quality.processing.decoded.format,
        scenario.format,
      );
      assert.equal(
        report.result.quality.processing.decoded.codedWidth,
        scenario.width,
      );
    }
    assert.ok(report.result.quality.processing.conversionMeanMs >= 0);
    const diagnostic = report.result.findings.find(
      (f) => f.type === 'GENERAL_FLASH',
    ).diagnostic;
    assert.equal(diagnostic.complete, true);
    if (!scenario.dense)
      assert.deepEqual(
        [
          ...new Set(
            diagnostic.samples.map((s) => `${s.red},${s.green},${s.blue}`),
          ),
        ].sort(),
        scenario.disjoint ? ['0,0,0', '255,255,255'] : ['0,255,0', '255,0,0'],
      );
    assert.equal(new Set(report.events).size, report.events.length);
    assert.ok(report.events.length >= 1 && report.events.length <= 8);

    const findings = report.result.findings.filter(
      (finding) => finding.type === 'GENERAL_FLASH',
    );
    if (scenario.dense) {
      const backend = report.result.quality.processing.analysisBackend;
      assert.equal(report.result.status, 'NEEDS_REVIEW');
      assert.ok(
        report.result.findings.some((finding) => finding.type === 'RED_FLASH'),
      );
      assert.equal(
        backend.engineStateBytes,
        report.result.quality.spatial.stateBytes,
      );
      assert.ok(backend.engineStateBytes <= 256 * 1024 * 1024);
      const transport = scenario.rgbaTransfer ? 'transfer' : 'video';
      if (scenario.forceJavaScript) {
        assert.equal(backend.backend, 'JS');
        assert.equal(backend.selectionReason, 'FORCED_JS');
        assert.equal(backend.denseFrames, 0);
        assert.equal(backend.inputCopiedBytes, 0);
        assert.equal(backend.wasmMemoryBytes, 0);
        const baseline = denseReports.get(transport);
        assert.ok(
          baseline,
          'Run the measured WASM case before its forced-JS counterpart',
        );
        assert.deepEqual(
          comparableResult(report.result),
          comparableResult(baseline.result),
          'Complete findings and non-performance quality must match across backends',
        );
        assert.deepEqual(
          report.liveEvents,
          baseline.liveEvents,
          'All live event payloads must match across backends',
        );
        assert.equal(
          baseline.result.quality.spatial.stateBytes,
          report.result.quality.spatial.stateBytes +
            baseline.result.quality.processing.analysisBackend.extraStateBytes,
        );
      } else {
        assert.equal(backend.backend, 'WASM_DENSE');
        assert.equal(backend.selectionReason, 'READY');
        assert.ok(
          backend.denseFrames > 0,
          'Heterogeneous frames must actually call WASM',
        );
        assert.ok(backend.wasmMemoryBytes > 0);
        assert.equal(
          backend.inputCopiedBytes,
          scenario.rgbaTransfer
            ? backend.denseFrames * scenario.width * scenario.height * 4
            : 0,
          'Native copyTo must use the arena directly; external RGBA copies must be accounted exactly',
        );
        denseReports.set(transport, report);
      }
    } else if (scenario.disjoint) {
      const scale = scenario.dpr ?? 1;
      assert.equal(findings.length, 2);
      for (const finding of findings) {
        assert.equal(finding.spatial.componentPixels, 12000 * scale * scale);
        assert.equal(finding.spatial.simultaneousPixels, 24000 * scale * scale);
        assert.ok(
          finding.spatial.componentPixels < (341 * 256 * scale * scale) / 4,
        );
        if (scenario.rescaledTransfer) {
          assert.equal(finding.spatial.visualField, undefined);
          assert.equal(report.result.status, 'INCONCLUSIVE');
        } else {
          assert.equal(finding.spatial.visualField.basis, 'W3C_CSS_REFERENCE');
          assert.equal(finding.spatial.visualField.widthPx, 341 * scale);
          assert.equal(finding.spatial.visualField.heightPx, 256 * scale);
          assert.equal(
            finding.spatial.visualField.maximumPixels,
            24000 * scale * scale,
          );
          assert.equal(
            finding.spatial.visualField.maximumRatio,
            24000 / (341 * 256),
          );
          assert.equal(finding.spatial.visualField.exceedsThreshold, true);
          assert.match(
            finding.spatial.visualField.reference,
            /341x256 CSS pixels/,
          );
          assert.match(
            finding.spatial.visualField.reference,
            /standard browser zoom/,
          );
          assert.match(
            finding.spatial.visualField.reference,
            /not physical calibration or a WCAG verdict/,
          );
        }
      }
    } else {
      // A candidate below the fixed reference-area threshold remains a finding;
      // adding an assumption must never become an automatic safety exemption.
      assert.ok(findings.length > 0);
      if (scenario.missingMapping || scenario.pageZoom) {
        assert.equal(findings[0].spatial.visualField, undefined);
        assert.ok(
          report.result.limitations.some((value) =>
            value.startsWith('CSS_REFERENCE_'),
          ),
        );
      } else {
        assert.equal(findings[0].spatial.visualField.maximumPixels, 256);
        assert.equal(findings[0].spatial.visualField.exceedsThreshold, false);
      }
    }
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
