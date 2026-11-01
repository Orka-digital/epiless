import { phaseExecutionIdentity } from './animation-phase-identity.mjs';
import { createPhaseJobs } from './animation-phase-jobs.mjs';
import { createPhaseObserver } from './animation-phase-observer.mjs';
// Real browser document/WAAPI clocks and tiny CSS changes, with explicitly
// synthetic pixel findings/capture quality. This is not native tabCapture proof.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  testPendingPhaseBounds,
  testPhaseDiscoveryBounds,
} from './animation-phase-bounds-browser.mjs';
const esbuild = createRequire(
  new URL('../../apps/chrome-extension/package.json', import.meta.url),
)('esbuild');
const src = new URL('../../apps/chrome-extension/src/', import.meta.url)
  .pathname;
const node = await esbuild.build({
  stdin: {
    contents:
      "export * from './verification';export * from './animation-phase';",
    resolveDir: src,
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const {
  compareVerification,
  replayStateKey,
  phasePlanFromEvidence,
  validPhaseEvidence,
} = await import(
  `data:text/javascript;base64,${Buffer.from(node.outputFiles[0].text).toString('base64')}`
);
const content = await esbuild.build({
  stdin: {
    contents:
      "import {createAnimationPhaseContent} from './animation-phase-content';globalThis.phase=createAnimationPhaseContent(()=>({roots:globalThis.phaseRoots??[document],complete:true}));",
    resolveDir: src,
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
});
const execution = await phaseExecutionIdentity(
  node.outputFiles[0].text,
  content.outputFiles[0].text,
);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const url = 'http://127.0.0.1:47821/phase';
let fixture = {
  triggered: false,
  fixed: false,
  removed: false,
  ambient: false,
};
await page.route(url, (route) =>
  route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><style>
body{background:#232323}#signal,#ambient{width:2px;height:2px;background:#232323}
${fixture.removed || fixture.timer ? '' : fixture.triggered ? '#signal.go' : '#signal'}${fixture.removed || fixture.timer ? '' : `{animation:signal 200ms steps(1,end) ${fixture.triggered ? '0s' : '4s'} 5;}`}
@keyframes signal{0%,100%{background:#232323}50%{background:${fixture.fixed ? '#2d2d2d' : '#7d7d7d'}}}
${fixture.ambient ? '#ambient{animation:ambient 10s infinite}@keyframes ambient{to{transform:translateX(1px)}}' : ''}
</style><button type="button" aria-controls="signal" aria-expanded="false" onclick="this.setAttribute('aria-expanded','true');document.querySelector('#signal').classList.add('go')">Show details</button><div id="signal"></div><div id="ambient"></div>${
      fixture.timer
        ? `<script>
// This signal belongs solely to the document timer. The button never schedules,
// restarts or changes it; matching action timing cannot establish causation.
setTimeout(()=>{window.timerFiredAt=performance.now();document.querySelector('#signal').animate([{backgroundColor:'#232323',offset:0,easing:'steps(1,end)'},{backgroundColor:'#7d7d7d',offset:0.5,easing:'steps(1,end)'},{backgroundColor:'#232323',offset:1}],{duration:200,iterations:5});},Math.max(0,1000-performance.now()));
</script>`
        : ''
    }`,
  }),
);
const load = async () => {
  await page.goto(url);
  await page.addScriptTag({ content: content.outputFiles[0].text });
};
const observe = createPhaseObserver(page, validPhaseEvidence);
const jobs = createPhaseJobs(url, {
  compareVerification,
  replayStateKey,
  phasePlanFromEvidence,
});
const results = {
  execution,
  supersedesScope:
    'The earlier retained phase-browser checkpoint omitted coincidental document-timer starts. TRIGGER now supplies additional timing evidence and never waives document coverage.',
  scope:
    'Actual browser document, animation and colour sampling; explicitly synthetic candidate/quality and source boundary clock, no tabCapture or native detector proof',
};
try {
  await load();
  const baseline = await observe(3000, 2050);
  assert.ok(baseline.evidence.animations.length);
  await load();
  const early = await observe(0, 2000);
  results.early = jobs(baseline, early);
  assert.equal(results.early.comparison.status, 'INCOMPARABLE');
  assert.ok(
    results.early.comparison.reasons.includes(
      'DOCUMENT_PHASE_INTERVAL_NOT_COVERED',
    ),
  );
  await load();
  const aligned = await observe(baseline.evidence.start.documentMs - 150, 2250);
  results.aligned = jobs(baseline, aligned);
  assert.equal(
    results.aligned.comparison.status,
    'REOBSERVED',
    JSON.stringify(results.aligned),
  );
  fixture.fixed = true;
  await load();
  const fixed = await observe(baseline.evidence.start.documentMs - 150, 2250);
  results.fixed = jobs(baseline, fixed);
  assert.equal(
    results.fixed.comparison.status,
    'NOT_OBSERVED',
    JSON.stringify(results.fixed),
  );
  fixture.removed = true;
  await load();
  const removed = await observe(baseline.evidence.start.documentMs - 150, 2250);
  results.removed = jobs(baseline, removed);
  assert.equal(
    results.removed.comparison.status,
    'NOT_OBSERVED',
    JSON.stringify(results.removed),
  );
  fixture = { triggered: true, fixed: false, removed: false, ambient: false };
  await load();
  const trigger = await observe(2000, 1400, true);
  fixture.fixed = true;
  await load();
  const triggerFixed = await observe(0, 1600, true);
  results.triggerFixed = jobs(trigger, triggerFixed, true);
  assert.equal(results.triggerFixed.phasePlan.mode, 'TRIGGER');
  assert.equal(
    results.triggerFixed.comparison.status,
    'INCOMPARABLE',
    JSON.stringify(results.triggerFixed),
  );
  assert.ok(
    results.triggerFixed.comparison.reasons.includes(
      'DOCUMENT_PHASE_INTERVAL_NOT_COVERED',
    ),
  );
  await load();
  const triggerAlignedFixed = await observe(
    trigger.evidence.start.documentMs - 150,
    1700,
    true,
  );
  results.triggerAlignedFixed = jobs(trigger, triggerAlignedFixed, true);
  assert.equal(
    results.triggerAlignedFixed.comparison.status,
    'NOT_OBSERVED',
    JSON.stringify(results.triggerAlignedFixed),
  );
  fixture = {
    triggered: true,
    fixed: false,
    removed: false,
    ambient: false,
    timer: true,
  };
  await load();
  const timerCoincidence = await observe(950, 1450, true);
  assert.ok(
    timerCoincidence.timerFiredAt >
      timerCoincidence.evidence.trigger.before.documentMs,
  );
  await load();
  const timerLate = await observe(3000, 1700, true);
  assert.equal(timerLate.evidence.animations.length, 0);
  results.timerCoincidence = jobs(timerCoincidence, timerLate, true);
  assert.equal(results.timerCoincidence.phasePlan.mode, 'TRIGGER');
  assert.equal(
    results.timerCoincidence.comparison.status,
    'INCOMPARABLE',
    JSON.stringify(results.timerCoincidence),
  );
  assert.ok(
    results.timerCoincidence.comparison.reasons.includes(
      'DOCUMENT_PHASE_INTERVAL_NOT_COVERED',
    ),
  );
  fixture = { triggered: true, fixed: false, removed: false, ambient: true };
  await load();
  const mixed = await observe(0, 1400, true);
  results.mixed = jobs(mixed, mixed, true);
  assert.equal(results.mixed.phasePlan.mode, 'DOCUMENT');
  fixture = { triggered: true, fixed: false, removed: false, ambient: false };
  await load();
  await page.evaluate(() => {
    const pending = document
      .querySelector('#signal')
      .animate([{ opacity: 1 }, { opacity: 1 }], { duration: 1000 });
    pending.pause();
  });
  const unresolved = await observe(0, 200, false, true);
  assert.ok(unresolved.evidence.reasons.includes('ANIMATION_PHASE_UNRESOLVED'));
  await load();
  results.pendingBounds = await testPendingPhaseBounds(page);
  results.discoveryBounds = await testPhaseDiscoveryBounds(page);
  results.inputs = {
    unresolved,
    baseline,
    early,
    aligned,
    fixed,
    removed,
    trigger,
    triggerFixed,
    triggerAlignedFixed,
    timerCoincidence,
    timerLate,
    mixed,
  };
  const output = process.env.EPI_LESS_PHASE_BROWSER_OUTPUT;
  if (output)
    await writeFile(output, JSON.stringify(results, null, 2) + '\n', {
      flag: 'wx',
    });
  console.log(
    JSON.stringify({
      result: 'PASS',
      comparisons: Object.fromEntries(
        Object.entries(results)
          .filter(([, v]) => v?.comparison)
          .map(([k, v]) => [k, { mode: v.phasePlan.mode, ...v.comparison }]),
      ),
      output,
    }),
  );
} finally {
  await browser.close();
}
