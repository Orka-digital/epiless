import { startNativeFixtureCollector } from './native-fixture-collector.mjs';
import { configureNativeFixture } from './native-fixture-config.mjs';
import { createNativeFixtureServer } from './native-fixture-server.mjs';
// Manual toolbar-capture gate. Static by default; optional tiny low-contrast motion.
// The opt-in candidate mode changes one 2 × 2 CSS-pixel signal. DENSE adds
// a separately disclosed low-contrast GPU workload during the control observation.
// Start this script, then use the real browser toolbar to authorise/start FlashGuard.
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodedPageSource } from './native-encoded-source.mjs';

const evidence = await mkdtemp(
  path.join(tmpdir(), 'flashguard-capture-validation-'),
);
const profile = path.join(evidence, 'browser-profile');
const requests = [];
const {
  gentleMotion,
  interactive,
  pixelProbe,
  videoFixture,
  denseFixture,
  encodedFixture,
  encodedRecheck,
  loopFixture,
  encodedAssets,
  encodedRecheckFixture,
  encodedRecheckModuleSha256,
  loopDocuments,
  loopHtml,
  loopFixtureIdentity,
  numericProbe,
  candidateFixture,
  candidateModePath,
  candidateCommandPath,
  emulateViewport,
  windowWidth,
  windowHeight,
} = await configureNativeFixture({ evidence });
const { server } = createNativeFixtureServer({
  requests,
  encodedRecheckFixture,
  loopFixture,
  loopDocuments,
  encodedAssets,
  candidateFixture,
  candidateModePath,
  loopHtml,
  interactive,
  pixelProbe,
  gentleMotion,
});
await new Promise((resolve) => server.listen(47819, '127.0.0.1', resolve));
const productionExtension = fileURLToPath(
  new URL('../../apps/chrome-extension/dist/', import.meta.url),
);
const buildHash = createHash('sha256');
for (const name of (await readdir(productionExtension)).sort()) {
  buildHash.update(name);
  buildHash.update('\0');
  buildHash.update(await readFile(path.join(productionExtension, name)));
  buildHash.update('\0');
}
const extensionBuild = {
  algorithm: 'sha256',
  input: 'sorted dist filenames, NUL, bytes, NUL',
  digest: buildHash.digest('hex'),
};
if (loopFixture || encodedRecheck) {
  const bundle = await readFile(
    path.join(productionExtension, 'background.js'),
    'utf8',
  );
  const identities = [
    ...new Set(
      [...bundle.matchAll(/["']([a-f0-9]{64})["']/g)].map((match) => match[1]),
    ),
  ];
  if (identities.length !== 1)
    throw new Error(
      'Loop/recheck fixture requires one unambiguous cold-build source identity in the actual background bundle.',
    );
  extensionBuild.embeddedScannerBuildSha256 = identities[0];
}
let extension = productionExtension;
// Test-only instrumentation of a copied bundle. Never shipped by build.mjs.
// Four numeric corner samples, once per geometry; no screenshot/video pixels
// are retained. This adds first-frame overhead, explicitly recorded in evidence.
if (numericProbe) {
  extension = path.join(evidence, 'instrumented-extension');
  await cp(productionExtension, extension, { recursive: true });
  const probe = `(() => {
    const OriginalWorker = globalThis.Worker, seen = new Set(), counts = new Map(), probes = [];
    globalThis.Worker = class extends OriginalWorker {
      postMessage(message, ...args) {
        const frame = message?.frame;
        const key=frame?.displayWidth+'x'+frame?.displayHeight;
        const count=message?.type === 'FRAME' && frame ? (counts.get(key)??0)+1 : 0;
        if(count)counts.set(key,count);
        const sample=${denseFixture ? 'count>0 && (count===1 || count%29===0) && probes.length<120' : 'count>0 && seen.size<6 && !seen.has(key)'};
        if (sample) {
          seen.add(key);
          const canvas = new OffscreenCanvas(1,1), ctx = canvas.getContext('2d',{colorSpace:'srgb',willReadFrequently:true});
          const w=frame.displayWidth,h=frame.displayHeight;
          const points=[[12,12],[w-13,12],[12,h-13],[w-13,h-13]];
          const colors=points.map(([x,y])=>{ctx.drawImage(frame,x,y,1,1,0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];});
          let metadata;try{const value=typeof frame.metadata==='function'?frame.metadata():undefined;metadata={available:!!value,captureTime:Number.isFinite(value?.captureTime)?value.captureTime:null,receiveTime:Number.isFinite(value?.receiveTime)?value.receiveTime:null}}catch{metadata={available:false}}
          probes.push({width:w,height:h,frameNumberAtGeometry:count,sourceTimestampMs:message.timestampMs,receiptEpochMs:performance.timeOrigin+performance.now(),timeOrigin:performance.timeOrigin,metadata,points,colors});
          void chrome.runtime.sendMessage({type:'FIXTURE_PIXEL_PROBE',probes}).catch(() => undefined);
        }
        return super.postMessage(message, ...args);
      }
    };
  })();\n`;
  const filename = path.join(extension, 'offscreen.js');
  await writeFile(filename, probe + (await readFile(filename, 'utf8')));
  extensionBuild.fixtureOffscreenSha256 = createHash('sha256')
    .update(await readFile(filename))
    .digest('hex');
}
const context = await chromium.launchPersistentContext(profile, {
  ...(process.env.EPI_LESS_FIXTURE_CHROMIUM_PATH
    ? { executablePath: process.env.EPI_LESS_FIXTURE_CHROMIUM_PATH }
    : { channel: 'chromium' }),
  headless: false,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
  viewport: emulateViewport ? { width: 1150, height: 850 } : null,
});
const worker =
  context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
if (numericProbe)
  await worker.evaluate(() => {
    chrome.runtime.onMessage.addListener((message, sender) => {
      if (
        sender.id === chrome.runtime.id &&
        message?.type === 'FIXTURE_PIXEL_PROBE'
      )
        void chrome.storage.local.set({ fixturePixelProbes: message.probes });
    });
  });
const extensionId = new URL(worker.url()).host;
const page = await context.newPage();
// Use a real window rather than Playwright device emulation: capture geometry
// must be observed independently from a synthetic CSS viewport override.
await worker.evaluate(
  async ({ width, height }) => {
    const window = await chrome.windows.getCurrent();
    await chrome.windows.update(window.id, { state: 'normal', width, height });
  },
  { width: windowWidth, height: windowHeight },
);
await page.goto('http://127.0.0.1:47819/');
await page.bringToFront();
const geometry = () =>
  page.evaluate(() => ({
    innerWidth,
    innerHeight,
    outerWidth,
    outerHeight,
    devicePixelRatio,
    screen: {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
    },
    visibility: document.visibilityState,
  }));
const initialGeometry = await geometry();
console.log(
  JSON.stringify({
    evidence,
    extensionId,
    browser: context.browser().version(),
    fixture: page.url(),
    interactive,
    extensionBuild,
    emulateViewport,
    initialGeometry,
    pixelProbe,
    denseFixture,
    candidateFixture,
    ...(encodedAssets
      ? { encodedSource: encodedPageSource(encodedAssets, loopFixture) }
      : {}),
    ...(loopFixture ? { loopFixture: loopFixtureIdentity } : {}),
    ...(candidateFixture ? { candidateModePath, candidateCommandPath } : {}),
  }),
);
const completed = new Set();
const completedCommands = new Set();
const { timer } = startNativeFixtureCollector({
  context,
  candidateFixture,
  candidateCommandPath,
  completedCommands,
  evidence,
  completed,
  worker,
  encodedRecheckFixture,
  requests,
  emulateViewport,
  windowWidth,
  windowHeight,
  initialGeometry,
  geometry,
  pixelProbe,
  denseFixture,
  loopFixture,
  loopFixtureIdentity,
  loopDocuments,
  extensionBuild,
  encodedRecheckModuleSha256,
  encodedAssets,
  encodedFixture,
  videoFixture,
  interactive,
  gentleMotion,
});
const stop = async () => {
  clearInterval(timer);
  await context.close();
  server.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
console.log(
  'Use the real extension toolbar. Press Ctrl+C to close only this isolated browser/fixture. Evidence stays in the printed folder.',
);
