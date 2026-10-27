import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

/** Sequential discarded unknowns must never look like an empty known inventory. */
export async function testPendingPhaseBounds(page) {
  const result = await page.evaluate(async () => {
    const target = document.createElement('div');
    target.style.cssText = 'width:2px;height:2px;background:#232323';
    document.body.append(target);
    phase.begin('pending-bound', 'pending-bound');
    let created = 0;
    for (let group = 0; group < 4; group++) {
      const animations = Array.from({ length: 10 }, () => {
        const animation = target.animate([{ opacity: 1 }, { opacity: 1 }], {
          duration: 1000,
        });
        animation.pause();
        created++;
        return animation;
      });
      await new Promise((resolve) => setTimeout(resolve, 180));
      for (const animation of animations) animation.cancel();
    }
    const evidence = phase.stop('pending-bound', 'pending-bound');
    target.remove();
    return { created, evidence };
  });
  assert.equal(result.created, 40);
  assert.equal(result.evidence.complete, false);
  assert.ok(
    result.evidence.reasons.includes('ANIMATION_PHASE_PENDING_LIMIT_REACHED'),
    JSON.stringify(result),
  );
  assert.ok(result.evidence.reasons.includes('ANIMATION_PHASE_UNRESOLVED'));
  assert.equal(result.evidence.animations.length, 0);
  return result;
}
/** First overflowing root is read once; later roots and subsequent ticks stop. */
export async function testPhaseDiscoveryBounds(page) {
  const result = await page.evaluate(async () => {
    const target = document.createElement('div');
    target.style.cssText = 'width:2px;height:2px';
    document.body.append(target);
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    globalThis.phaseRoots = [document, shadow];
    let documentReads = 0,
      shadowReads = 0;
    const documentOwn = Object.getOwnPropertyDescriptor(
      document,
      'getAnimations',
    );
    const originalDocument = document.getAnimations.bind(document),
      originalShadow = shadow.getAnimations.bind(shadow);
    document.getAnimations = () => {
      documentReads++;
      return originalDocument();
    };
    shadow.getAnimations = () => {
      shadowReads++;
      return originalShadow();
    };
    const animations = Array.from({ length: 40 }, () => {
      const a = target.animate([{ opacity: 1 }, { opacity: 1 }], {
        duration: 1000,
      });
      a.pause();
      return a;
    });
    let evidence;
    try {
      phase.begin('discovery-bound', 'discovery-bound');
      await new Promise((resolve) => setTimeout(resolve, 350));
      evidence = phase.stop('discovery-bound', 'discovery-bound');
    } finally {
      if (documentOwn)
        Object.defineProperty(document, 'getAnimations', documentOwn);
      else delete document.getAnimations;
      delete shadow.getAnimations;
      delete globalThis.phaseRoots;
      for (const animation of animations) animation.cancel();
      target.remove();
      host.remove();
    }
    return { documentReads, shadowReads, evidence };
  });
  assert.equal(
    result.documentReads,
    1,
    'Do not re-enumerate after the first overflow',
  );
  assert.equal(
    result.shadowReads,
    0,
    'Do not visit later roots after overflow',
  );
  assert.equal(result.evidence.complete, false);
  assert.ok(result.evidence.reasons.includes('ANIMATION_PHASE_LIMIT_REACHED'));
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { createRequire } = await import('node:module');
  const { chromium } = await import('@playwright/test');
  const esbuild = createRequire(
    new URL('../../apps/chrome-extension/package.json', import.meta.url),
  )('esbuild');
  const built = await esbuild.build({
    stdin: {
      contents:
        "import {createAnimationPhaseContent} from './animation-phase-content';globalThis.phase=createAnimationPhaseContent(()=>({roots:globalThis.phaseRoots??[document],complete:true}));",
      resolveDir: new URL('../../apps/chrome-extension/src/', import.meta.url)
        .pathname,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('http://127.0.0.1:47821/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><body></body>',
      }),
    );
    await page.goto('http://127.0.0.1:47821/');
    await page.addScriptTag({ content: built.outputFiles[0].text });
    console.log(
      JSON.stringify({
        result: 'PASS',
        browser: browser.version(),
        pending: await testPendingPhaseBounds(page),
        discovery: await testPhaseDiscoveryBounds(page),
      }),
    );
  } finally {
    await browser.close();
  }
}
