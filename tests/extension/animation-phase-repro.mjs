// Browser-clock regression for a delayed tiny CSS effect on an already open page.
// Native capture/engine findings and quality are deliberately synthetic here.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const esbuild = createRequire(
  new URL('../../apps/chrome-extension/package.json', import.meta.url),
)('esbuild');
const built = await esbuild.build({
  entryPoints: [
    new URL('../../apps/chrome-extension/src/verification.ts', import.meta.url)
      .pathname,
  ],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { compareVerification, replayStateKey } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const url = 'http://127.0.0.1:47821/phase';
await page.route(url, (route) =>
  route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><style>
body{background:#232323}#signal{width:2px;height:2px;background:#232323;animation:signal 200ms steps(1,end) 4s 5}
@keyframes signal{0%,100%{background:#232323}50%{background:#7d7d7d}}</style><div id="signal"></div>`,
  }),
);
const observe = async (startAgeMs) => {
  await page.goto(url);
  await page.waitForFunction((age) => performance.now() >= age, startAgeMs);
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const samples = [];
        const start = performance.now();
        const tick = () => {
          const age = performance.now();
          const a = document.querySelector('#signal').getAnimations()[0];
          samples.push({
            ageMs: age,
            epochMs: performance.timeOrigin + age,
            background: getComputedStyle(document.querySelector('#signal'))
              .backgroundColor,
            animation: a
              ? {
                  currentTimeMs: a.currentTime,
                  startTimeMs: a.startTime,
                  playState: a.playState,
                  durationMs: a.effect.getTiming().duration,
                  delayMs: a.effect.getTiming().delay,
                }
              : null,
          });
          if (age - start < 2000) requestAnimationFrame(tick);
          else resolve({ startAgeMs: start, endAgeMs: age, samples });
        };
        tick();
      }),
  );
};
try {
  const baselineTrace = await observe(3000),
    replayTrace = await observe(0);
  assert.ok(
    baselineTrace.samples.some((s) => s.background === 'rgb(125, 125, 125)'),
  );
  assert.equal(
    replayTrace.samples.some((s) => s.background === 'rgb(125, 125, 125)'),
    false,
  );
  const recipe = {
    version: 1,
    route: url,
    profile: 'current',
    viewport: { width: 1280, height: 720, dpr: 1 },
    steps: [],
    durationMs: 2000,
    stateKey: '',
  };
  recipe.stateKey = replayStateKey(recipe);
  const finding = {
    id: 'candidate',
    type: 'GENERAL_FLASH',
    severity: 'warning',
    reviewStatus: 'NEEDS_REVIEW',
    startMs: 1000,
    endMs: 1800,
    flashesInWindow: 3.5,
    qualifyingTransitions: 7,
    affectedRatio: 4 / (1280 * 720),
    region: { x: 8, y: 8, width: 2, height: 2 },
    message:
      'Synthetic candidate representing the independently observed tiny CSS sequence',
  };
  const job = (id, trace, positive) => ({
    id,
    state: 'COMPLETED',
    origin: new URL(url).origin,
    startUrl: url,
    engineVersion: 'phase-regression',
    runnerVersion: 'phase-regression',
    scannerBuildSha256: 'a'.repeat(64),
    startedAt:
      id === 'baseline' ? '2026-01-01T00:00:00Z' : '2026-01-01T01:00:00Z',
    endedAt:
      id === 'baseline' ? '2026-01-01T00:00:10Z' : '2026-01-01T01:00:10Z',
    tasks: [
      {
        id: 'route',
        url,
        observations: [
          {
            id: 'observation',
            scenario: 'initial-viewport',
            achieved: true,
            coverage: 'TESTED',
            replay: structuredClone(recipe),
            measurement: {
              status: positive ? 'NEEDS_REVIEW' : 'NO_ISSUES_OBSERVED',
              findings: positive ? [finding] : [],
              limitations: [],
              quality: {
                frameCount: 120,
                effectiveFps: 60,
                maxGapMs: 17,
                width: 1280,
                height: 720,
                downsampled: false,
                interrupted: false,
                captureWindowMs: 2000,
                leadingIdleMs: 0,
                trailingIdleMs: 0,
              },
            },
            browserPhaseRepro: trace,
          },
        ],
      },
    ],
  });
  const baseline = job('baseline', baselineTrace, true),
    repeated = job('repeated', replayTrace, false);
  repeated.verificationOf = {
    jobId: baseline.id,
    taskId: 'route',
    observationId: 'observation',
  };
  const comparison = compareVerification(
    baseline,
    { taskId: 'route', observationId: 'observation', findingId: 'candidate' },
    repeated,
  );
  const evidence = {
    scope:
      'Actual browser CSS/document clocks; synthetic capture quality and candidate; no native tabCapture evidence',
    baselineTrace,
    replayTrace,
    comparison,
  };
  const output = process.env.EPI_LESS_PHASE_REPRO_OUTPUT;
  if (output)
    await writeFile(output, JSON.stringify(evidence, null, 2) + '\n', {
      flag: 'wx',
    });
  console.log(
    JSON.stringify({
      baselineInterval: [baselineTrace.startAgeMs, baselineTrace.endAgeMs],
      replayInterval: [replayTrace.startAgeMs, replayTrace.endAgeMs],
      comparison,
      output,
    }),
  );
  assert.equal(
    comparison.status,
    'INCOMPARABLE',
    'An unchanged delayed effect outside the fresh replay window must never count as a clean recheck',
  );
} finally {
  await browser.close();
}
