// Manual toolbar-capture gate. Static by default; optional tiny low-contrast motion.
// The opt-in candidate mode changes one 2 × 2 CSS-pixel signal. DENSE adds
// a separately disclosed low-contrast GPU workload during the control observation.
// Start this script, then use the real browser toolbar to authorise/start FlashGuard.
import { chromium } from '@playwright/test';
import { mkdtemp, writeFile, readFile, readdir, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { interactiveFixture } from './interactive-fixture.mjs';
import { nativeCandidatePage } from './native-candidate-page.mjs';
import {
  NativeEncodedRecheckFixture,
  recheckMediaPath,
  recheckEvidencePath,
} from './native-encoded-recheck-source.mjs';
import { nativeLoopPage, appendLoopTrace } from './native-loop-page.mjs';
import {
  nativeLoopCadencePage,
  LOOP_CADENCE_POLICY,
} from './native-loop-cadence-page.mjs';
import {
  encodedPageSource,
  loadNativeEncodedAssets,
  serveEncodedAsset,
} from './native-encoded-source.mjs';
import { tmpdir } from 'node:os';
import { arch, cpus, platform, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'node:http';

const evidence = await mkdtemp(
  path.join(tmpdir(), 'flashguard-capture-validation-'),
);
const profile = path.join(evidence, 'browser-profile');
const requests = [];
const gentleMotion = process.env.EPI_LESS_FIXTURE_MOTION === '1';
const interactive = process.env.EPI_LESS_FIXTURE_INTERACTIVE === '1';
const pixelProbe = process.env.EPI_LESS_FIXTURE_PIXEL_PROBE === '1';
const videoFixture = process.env.EPI_LESS_FIXTURE_VIDEO === '1';
const denseFixture = process.env.EPI_LESS_FIXTURE_DENSE === '1';
const encodedFixture = process.env.EPI_LESS_FIXTURE_ENCODED === '1';
const encodedRecheck = process.env.EPI_LESS_FIXTURE_ENCODED_RECHECK === '1';
const loopFixture = process.env.EPI_LESS_FIXTURE_LOOP === '1';
const loopCadence = process.env.EPI_LESS_FIXTURE_LOOP_CADENCE === '1';
if (encodedRecheck && (!encodedFixture || loopFixture))
  throw new Error('ENCODED_RECHECK requires ENCODED=1 and cannot use LOOP.');
if (loopCadence && (!loopFixture || !encodedFixture))
  throw new Error('LOOP_CADENCE requires LOOP=1 and ENCODED=1.');
if (loopFixture && !encodedFixture)
  throw new Error(
    'LOOP requires ENCODED=1 and always uses the immutable fixed control.',
  );
if (
  encodedFixture &&
  (videoFixture || denseFixture || pixelProbe || interactive)
)
  throw new Error(
    'ENCODED is a separate fixture; do not combine it with VIDEO, DENSE, PIXEL_PROBE or INTERACTIVE.',
  );
const encodedAssets = encodedFixture
  ? await loadNativeEncodedAssets(process.env.EPI_LESS_FIXTURE_ENCODED_DIR)
  : undefined;
const encodedRecheckFixture = encodedRecheck
  ? new NativeEncodedRecheckFixture(encodedAssets)
  : undefined;
const encodedRecheckModuleSha256 = encodedRecheck
  ? createHash('sha256')
      .update(
        await readFile(
          new URL('./native-encoded-recheck-source.mjs', import.meta.url),
        ),
      )
      .digest('hex')
  : undefined;
const loopDocuments = new Map();
const loopHtml = loopFixture
  ? (loopCadence ? nativeLoopCadencePage : nativeLoopPage)(
      encodedPageSource(encodedAssets, true),
    )
  : undefined;
const loopFixtureIdentity = loopFixture
  ? {
      pageModuleSha256: createHash('sha256')
        .update(
          await readFile(new URL('./native-loop-page.mjs', import.meta.url)),
        )
        .digest('hex'),
      servedHtmlSha256: createHash('sha256').update(loopHtml).digest('hex'),
      ...(loopCadence
        ? {
            cadenceVariant: {
              moduleSha256: createHash('sha256')
                .update(
                  await readFile(
                    new URL('./native-loop-cadence-page.mjs', import.meta.url),
                  ),
                )
                .digest('hex'),
              policy: LOOP_CADENCE_POLICY,
            },
          }
        : {}),
      source: 'EXISTING_FIXED_VP9_LOOP',
      pageTrace:
        'Independent page currentTime and rVFC metadata, bounded per document over localhost; no scanner generation IDs or raw frames.',
    }
  : undefined;
const numericProbe = pixelProbe || denseFixture;
if (pixelProbe && denseFixture)
  throw new Error(
    'Choose static geometry probes or the dense workload, not both.',
  );
const candidateFixture =
  encodedFixture ||
  videoFixture ||
  denseFixture ||
  process.env.EPI_LESS_FIXTURE_CANDIDATE === '1';
const candidateModePath = path.join(evidence, 'candidate-mode.json');
const candidateCommandPath = path.join(evidence, 'candidate-command.json');
if (candidateFixture)
  await writeFile(
    candidateModePath,
    JSON.stringify({
      fixed: loopFixture,
      video: videoFixture,
      dense: denseFixture,
      ...(encodedFixture ? { encoded: true } : {}),
      ...(loopFixture ? { loop: true } : {}),
    }),
  );
const emulateViewport = process.env.EPI_LESS_FIXTURE_EMULATED_VIEWPORT === '1';
const windowWidth = Number(process.env.EPI_LESS_FIXTURE_WINDOW_WIDTH ?? 900);
const windowHeight = Number(process.env.EPI_LESS_FIXTURE_WINDOW_HEIGHT ?? 650);
if (
  ![windowWidth, windowHeight].every(
    (value) => Number.isInteger(value) && value >= 400 && value <= 4000,
  )
)
  throw new Error(
    'Fixture window dimensions must be integer pixels from 400 to 4000.',
  );
const server = createServer(async (request, response) => {
  requests.push({ path: request.url, at: new Date().toISOString() });
  if (encodedRecheckFixture && request.url === recheckEvidencePath) {
    try {
      if (request.method !== 'POST') throw new Error('Expected trace POST');
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 128 * 1024) throw new Error('Trace request cap');
        chunks.push(chunk);
      }
      encodedRecheckFixture.append(
        JSON.parse(Buffer.concat(chunks).toString('utf8')),
      );
      response.writeHead(204);
      response.end();
    } catch {
      response.writeHead(400);
      response.end('Invalid bounded recheck trace');
    }
    return;
  }
  if (encodedRecheckFixture && request.url === recheckMediaPath) {
    encodedRecheckFixture.serve(request, response);
    return;
  }
  if (loopFixture && request.url === '/__native-loop-evidence') {
    try {
      if (request.method !== 'POST') throw new Error('Expected trace POST');
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 128 * 1024) throw new Error('Trace request cap');
        chunks.push(chunk);
      }
      appendLoopTrace(
        loopDocuments,
        JSON.parse(Buffer.concat(chunks).toString('utf8')),
        encodedAssets.assets.fixed.record.sha256,
      );
      response.writeHead(204);
      response.end();
    } catch {
      response.writeHead(400);
      response.end('Invalid bounded loop trace');
    }
    return;
  }
  if (request.url === '/robots.txt') {
    response.setHeader('Content-Type', 'text/plain');
    if (candidateFixture) {
      response.end('User-agent: *\n');
      return;
    }
    response.end(
      'User-agent: *\nDisallow: /logout\nSitemap: http://127.0.0.1:47819/sitemap.xml\n',
    );
    return;
  }
  if (candidateFixture) {
    if (encodedAssets && request.url?.startsWith('/__native-encoded/')) {
      const asset = Object.values(encodedAssets.assets).find(
        (value) => request.url === `/__native-encoded/${value.record.file}`,
      );
      if (!asset) {
        response.writeHead(404);
        response.end('Unknown encoded fixture asset');
        return;
      }
      serveEncodedAsset(request, response, asset.bytes);
      return;
    }
    if (request.url !== '/') {
      response.writeHead(404);
      response.end('No additional fixture route');
      return;
    }
    const mode = JSON.parse(await readFile(candidateModePath, 'utf8'));
    response.setHeader('Content-Type', 'text/html');
    if (loopFixture) {
      response.end(loopHtml);
      return;
    }
    if (encodedRecheckFixture) {
      response.setHeader('Cache-Control', 'no-store');
      response.end(encodedRecheckFixture.document(mode.fixed === true));
      return;
    }
    response.end(
      nativeCandidatePage({
        fixed: mode.fixed === true,
        video: mode.video === true,
        dense: mode.dense === true,
        ...(encodedAssets
          ? { encoded: encodedPageSource(encodedAssets, mode.fixed === true) }
          : {}),
      }),
    );
    return;
  }
  if (request.url === '/sitemap.xml') {
    response.setHeader('Content-Type', 'application/xml');
    response.end(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://127.0.0.1:47819/sitemap-only</loc></url></urlset>',
    );
    return;
  }
  if (interactive && ['/redirect', '/redirect-again'].includes(request.url)) {
    response.writeHead(302, { Location: '/reached' });
    response.end();
    return;
  }
  if (interactive && request.url === '/spa/client') {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end(
      'SPA route must be reached through its rendered pushState link.',
    );
    return;
  }
  response.setHeader('Content-Type', 'text/html');
  if (interactive) {
    response.end(interactiveFixture({ controls: request.url === '/' }));
    return;
  }
  const title =
    request.url === '/'
      ? 'Home'
      : request.url === '/about'
        ? 'About'
        : request.url === '/sitemap-only'
          ? 'Sitemap discovery'
          : 'Guide';
  const geometryMarkers = pixelProbe
    ? `<style>html{overflow:hidden}.geometry-marker{position:fixed;width:20px;height:20px;z-index:2147483647;pointer-events:none}</style><i class="geometry-marker" style="left:0;top:0;background:rgb(40,80,120)"></i><i class="geometry-marker" style="right:0;top:0;background:rgb(140,180,220)"></i><i class="geometry-marker" style="left:0;bottom:0;background:rgb(80,120,160)"></i><i class="geometry-marker" style="right:0;bottom:0;background:rgb(180,140,100)"></i>`
    : '';
  const marker =
    geometryMarkers +
    (gentleMotion
      ? '<span aria-hidden="true" style="position:fixed;left:20px;top:20px;width:4px;height:4px;background:#e8e8e8;animation:gentle 20s linear infinite alternate"></span><style>@keyframes gentle{to{transform:translateX(200px)}}</style>'
      : '');
  response.end(
    `<!doctype html><html lang="nl"><meta charset="utf-8"><title>FlashGuard veilige fixture — ${title}</title><style>body{font:20px Arial;color:#123;background:#eee;padding:60px;max-width:700px}a{margin-right:25px}button{font:inherit;padding:12px}section{height:700px}</style>${marker}<h1>Statische testpagina: ${title}</h1><p>Geen flitsen, geen geluid. ${gentleMotion ? 'Cadencetest met een klein, langzaam en contrastarm bewegend punt.' : 'Geen animatie.'}</p><nav><a href="/">Home</a><a href="/about">About</a><a href="/guide">Guide</a><a href="/logout">Logout — overslaan</a></nav><p><button type="button" aria-controls="details" aria-expanded="false" onclick="this.setAttribute('aria-expanded','true');document.getElementById('details').hidden=false">Toon details</button></p><div id="details" hidden>Statische aanvullende uitleg.</div><section><p>Statische scrollsectie.</p></section><p>Einde van de pagina.</p></html>`,
  );
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
const timer = setInterval(async () => {
  try {
    const dashboard = context
      .pages()
      .find((candidate) => candidate.url().includes('/dashboard.html'));
    if (!dashboard) return;
    if (candidateFixture) {
      const command = await readFile(candidateCommandPath, 'utf8')
        .then(JSON.parse)
        .catch(() => undefined);
      if (
        command &&
        typeof command.id === 'string' &&
        /^[a-z0-9-]{1,80}$/.test(command.id) &&
        !completedCommands.has(command.id)
      ) {
        completedCommands.add(command.id);
        if (
          !['PREPARE_RECHECK', 'REVIEW_ISSUE', 'GET_STATE', 'EXPORT'].includes(
            command.message?.type,
          )
        )
          throw new Error(
            'Fixture control only supports review, inspection and recheck preparation; capture still needs the real toolbar.',
          );
        const result = await dashboard.evaluate(
          (message) => chrome.runtime.sendMessage(message),
          command.message,
        );
        await writeFile(
          path.join(evidence, `command-${command.id}.json`),
          JSON.stringify(result, null, 2),
        );
        console.log(
          JSON.stringify({
            command: command.id,
            ok: result.ok,
            error: result.error,
          }),
        );
      }
    }
    const response = await dashboard.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'GET_STATE' }),
    );
    for (const job of response.value.jobs) {
      if (completed.has(job.id)) continue;
      console.log(
        JSON.stringify({
          id: job.id,
          state: job.state,
          routes: job.tasks.map((task) => ({
            url: task.url,
            state: task.state,
            observations: task.observations.map((observation) => ({
              scenario: observation.scenario,
              frames: observation.measurement?.quality.frameCount,
              fps: observation.measurement?.quality.effectiveFps,
            })),
          })),
        }),
      );
      if (
        ['COMPLETED', 'PARTIAL', 'INTERRUPTED', 'ERROR'].includes(job.state)
      ) {
        const candidateState = candidateFixture
          ? await worker.evaluate(async (tabId) => {
              const result = await chrome.scripting.executeScript({
                target: { tabId },
                world: 'MAIN',
                func: () => {
                  window.__nativeLoopFlush?.();
                  window.__nativeRecheckFlush?.();
                  return {
                    geometry: {
                      innerWidth,
                      innerHeight,
                      outerWidth,
                      outerHeight,
                      devicePixelRatio,
                      visibility: document.visibilityState,
                    },
                    fixture: window.__nativeCandidateFixture ?? null,
                  };
                },
              });
              return result[0]?.result;
            }, job.tabId)
          : undefined;
        if (encodedRecheckFixture && candidateState?.fixture)
          encodedRecheckFixture.append(candidateState.fixture);
        const report = await dashboard.evaluate(
          (id) => chrome.runtime.sendMessage({ type: 'EXPORT', id }),
          job.id,
        );
        await writeFile(
          path.join(evidence, `${job.id}.json`),
          JSON.stringify(report.value, null, 2),
        );
        if (candidateFixture)
          await writeFile(
            path.join(evidence, `${job.id}-local-job.json`),
            JSON.stringify(job, null, 2),
          );
        await writeFile(
          path.join(evidence, 'requests.json'),
          JSON.stringify(requests, null, 2),
        );
        await writeFile(
          path.join(evidence, 'environment.json'),
          JSON.stringify(
            {
              browser: context.browser().version(),
              platform: process.platform,
              machine: {
                arch: arch(),
                os: platform(),
                release: release(),
                cpuModel: cpus()[0]?.model,
                logicalCpus: cpus().length,
              },
              recordedAt: new Date().toISOString(),
              emulateViewport,
              requestedWindow: { width: windowWidth, height: windowHeight },
              initialGeometry,
              finalGeometry: candidateState?.geometry ?? (await geometry()),
              pixelProbe: pixelProbe
                ? {
                    instrumentation:
                      'Temporary copied extension samples four static corners once per source geometry, adding first-frame overhead; production dist is unchanged.',
                    expectedColors: [
                      [40, 80, 120, 255],
                      [140, 180, 220, 255],
                      [80, 120, 160, 255],
                      [180, 140, 100, 255],
                    ],
                    samples: await dashboard.evaluate(
                      async () =>
                        (await chrome.storage.local.get('fixturePixelProbes'))
                          .fixturePixelProbes ?? [],
                    ),
                  }
                : null,
              denseProbe: denseFixture
                ? {
                    instrumentation:
                      'Temporary copied extension samples four corner RGB values on first/every29th submitted frame, at most120 samples, adding periodic readback overhead. No images retained. Production dist unchanged; timings include fixture instrumentation.',
                    channelMinimum: 90,
                    channelMaximum: 113,
                    samples: await dashboard.evaluate(
                      async () =>
                        (await chrome.storage.local.get('fixturePixelProbes'))
                          .fixturePixelProbes ?? [],
                    ),
                  }
                : null,
              ...(candidateFixture
                ? {
                    candidateFixture: candidateState?.fixture,
                  }
                : {}),
              ...(loopFixture
                ? {
                    loopFixture: loopFixtureIdentity,
                    loopDocuments: [...loopDocuments.values()],
                  }
                : {}),
              extensionBuild,
              ...(encodedRecheckFixture
                ? {
                    encodedRecheck: {
                      moduleSha256: encodedRecheckModuleSha256,
                      ...encodedRecheckFixture.snapshot(),
                    },
                  }
                : {}),
              ...(encodedAssets
                ? {
                    encodedSource: {
                      manifestSha256: encodedAssets.manifestSha256,
                      manifest: encodedAssets.manifest,
                    },
                  }
                : {}),
              fixture: loopFixture
                ? 'An existing finite muted looping video displays only the immutable constant grey35 fixed.webm VP9 control at64×64 CSS pixels. No autoplay, flashes, audio or canvas media source. The autonomous supported media action starts playback; the runner seeks near the existing end and measures real currentTime and rVFC wraps. A4px low-contrast point moves slowly for capture cadence. Independent bounded page metadata survives document reloads through the localhost fixture collector; no raw frames are retained.'
                : encodedFixture
                  ? 'A real muted 2×2 CSS-pixel HTML video plays a pre-encoded lossless VP9/WebM file only after a supported disclosure. Before capture, all 53 decoded RGBA frames and PTS are checked against the grey35/125 2.08s signal plus grey35 end-frame. No audio, canvas media source, large flashing area or automatic signal playback. rVFC is presentation evidence; expected decoded RGB is not assumed to prove browser colour output.'
                  : videoFixture
                    ? 'A real muted 2×2 CSS-pixel HTML video presents a detached canvas.captureStream source, grey35/125 for2.08s after disclosure; no encoded media file and no audio. Ground truth records source draws separately from actual requestVideoFrameCallback presentation clocks.' +
                      (denseFixture
                        ? ' A full-viewport WebGL2 background changes for5s after the same control, with all RGB channels bounded to90–113; draw timestamps are recorded independently of capture.'
                        : '')
                    : candidateFixture
                      ? 'A 2×2 CSS-pixel marker alternates between grey35 and grey125 for 2.08s after a supported disclosure control; fixed mode keeps grey35. Other content static with one slow low-contrast cadence marker. No audio.'
                      : interactive
                        ? 'static DOM menu/tab/carousel/consent, muted grey canvas-stream video, pushState links, redirect and lazy growth; no flashing/audio'
                        : gentleMotion
                          ? 'static content plus low-contrast 4px marker moving slowly without flashes'
                          : 'static, no animation/audio',
              headless: false,
            },
            null,
            2,
          ),
        );
        if (candidateFixture)
          await cp(
            path.join(evidence, 'environment.json'),
            path.join(evidence, `${job.id}-environment.json`),
          );
        await dashboard.screenshot({
          path: path.join(evidence, `${job.id}.png`),
          fullPage: true,
        });
        completed.add(job.id);
      }
    }
  } catch (error) {
    console.error(String(error));
  }
}, 10000);
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
