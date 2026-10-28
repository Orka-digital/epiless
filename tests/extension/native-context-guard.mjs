// Manual real-toolbar integration fixture. Never attaches Playwright/CDP and
// never sends START/RESUME or requests a capture token. See --prepare-only.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { arch, cpus, release, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeCandidatePage } from './native-candidate-page.mjs';

const mode =
  process.argv.find((value) => value.startsWith('--mode='))?.slice(7) ?? 'zoom';
if (!['zoom', 'resize', 'cancel', 'complete'].includes(mode))
  throw new Error('Use --mode=zoom|resize|cancel|complete');
if (
  process.argv
    .slice(2)
    .some(
      (value) =>
        value !== '--prepare-only' &&
        value !== '--tab-switch-probe' &&
        value !== '--owned-scan' &&
        !/^--mode=(zoom|resize|cancel|complete)$/.test(value),
    )
)
  throw new Error('Unknown fixture argument');
const prepareOnly = process.argv.includes('--prepare-only');
const tabSwitchProbe = process.argv.includes('--tab-switch-probe');
const ownedScan = process.argv.includes('--owned-scan');
if (tabSwitchProbe && mode !== 'cancel')
  throw new Error('--tab-switch-probe is only valid with --mode=cancel');
if (ownedScan && (!['cancel', 'complete'].includes(mode) || tabSwitchProbe))
  throw new Error(
    '--owned-scan requires --mode=cancel|complete without a tab-switch probe',
  );
if (mode === 'complete' && !ownedScan)
  throw new Error('--mode=complete requires --owned-scan');
const evidenceDirectory = await mkdtemp(
  path.join(tmpdir(), `flashguard-native-context-${mode}-`),
);
const extension = path.join(evidenceDirectory, 'instrumented-extension');
const production = fileURLToPath(
  new URL('../../apps/chrome-extension/dist-advanced/', import.meta.url),
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function hashDirectory(directory) {
  const hash = createHash('sha256');
  for (const name of (await readdir(directory)).sort()) {
    hash
      .update(name)
      .update('\0')
      .update(await readFile(path.join(directory, name)))
      .update('\0');
  }
  return hash.digest('hex');
}
const productionSha256 = await hashDirectory(production);
let embeddedScannerBuildSha256;
if (ownedScan) {
  const bundle = await readFile(path.join(production, 'background.js'), 'utf8');
  const identities = [
    ...new Set(
      [...bundle.matchAll(/["']([a-f0-9]{64})["']/g)].map((match) => match[1]),
    ),
  ];
  if (identities.length !== 1)
    throw new Error(
      'Owned fixture requires one unambiguous cold-build source identity in the actual background bundle.',
    );
  embeddedScannerBuildSha256 = identities[0];
}
await cp(production, extension, { recursive: true });
const manifest = JSON.parse(
  await readFile(path.join(extension, 'manifest.json'), 'utf8'),
);
if (!manifest.permissions.includes('debugger'))
  throw new Error(
    'Build dist-advanced first; no permission is fabricated by this fixture.',
  );
// Keep the manifest and every production permission unchanged. CORS is allowed
// by this loopback evidence endpoint; site access is granted through real UI.
const geometry = [];
let originalTab, originalDocumentId;
// Request callbacks may observe startup before the environment has been collected.
// eslint-disable-next-line prefer-const
let environment;
let browser,
  stopping = false;
const server = createServer(async (request, response) => {
  try {
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-headers', 'content-type');
    if (request.method === 'OPTIONS') {
      response.end();
      return;
    }
    if (request.method === 'POST') {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 15_000_000) {
          response.writeHead(413);
          response.end();
          return;
        }
      }
      const value = JSON.parse(body);
      if (request.url === '/geometry') {
        geometry.push(value);
        if (geometry.length > 600) geometry.shift();
      } else if (ownedScan && request.url === '/original-tab') {
        if (originalTab)
          throw new Error('Original fixture tab already recorded');
        if (
          !Number.isSafeInteger(value.tabId) ||
          !Number.isSafeInteger(value.windowId)
        )
          throw new Error('Original fixture tab identity unavailable');
        originalTab = value;
      } else if (request.url === '/progress')
        console.log(JSON.stringify(value));
      else if (request.url === '/checkpoint') {
        await writeFile(
          path.join(evidenceDirectory, 'checkpoint.json'),
          JSON.stringify(value, null, 2),
        );
      } else if (request.url === '/terminal') {
        if ((await hashDirectory(production)) !== productionSha256)
          throw new Error('Production build changed during fixture');
        value.environment = environment;
        value.pageGeometry = geometry;
        value.geometryBeforeStart = geometry.findLast(
          (entry) => entry.at < Date.parse(value.job.startedAt),
        );
        await writeFile(
          path.join(evidenceDirectory, 'evidence.json'),
          JSON.stringify(value, null, 2),
        );
        await writeFile(
          path.join(evidenceDirectory, 'local-job.json'),
          JSON.stringify(value.job, null, 2),
        );
        await writeFile(
          path.join(evidenceDirectory, 'report.json'),
          JSON.stringify(value.report, null, 2),
        );
        console.log(
          JSON.stringify({
            terminal: value.job.state,
            mode,
            evidenceDirectory,
            errors: value.errors,
            actionPerformed: Boolean(value.roundTrip || value.cancellation),
          }),
        );
      } else {
        response.writeHead(404);
      }
      response.end('ok');
      return;
    }
    if (request.url.startsWith('/geometry-before-start?')) {
      const at = Number(
        new URL(request.url, 'http://localhost').searchParams.get('at'),
      );
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify(geometry.findLast((entry) => entry.at < at) ?? null),
      );
      return;
    }
    if (ownedScan && request.url === '/original-page') {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          tab: originalTab ?? null,
          documentId: originalDocumentId ?? null,
          geometry:
            geometry.findLast(
              (entry) => entry.documentId === originalDocumentId,
            ) ?? null,
        }),
      );
      return;
    }
    if (request.url === '/robots.txt') {
      response.end('User-agent: *\n');
      return;
    }
    if (request.url !== '/') {
      response.writeHead(404);
      response.end('No other route');
      return;
    }
    response.setHeader('content-type', 'text/html');
    const documentId = ownedScan ? randomUUID() : undefined;
    if (ownedScan) originalDocumentId ??= documentId;
    // The same tiny control-triggered CSS signal used in existing native detail
    // fixtures. Cancel mode uses a static signal, retaining only slow low contrast motion.
    response.end(
      nativeCandidatePage({
        fixed: mode === 'cancel' || mode === 'complete',
      }).replace(
        '</body>',
        `<script>
      ${ownedScan ? `globalThis.__nativeContextDocumentId=${JSON.stringify(documentId)};` : ''}
      function geometry(){fetch('/geometry',{method:'POST',body:JSON.stringify({at:Date.now(),width:innerWidth,height:innerHeight,dpr:devicePixelRatio,outerWidth,outerHeight,visibility:document.visibilityState${ownedScan ? `,documentId:${JSON.stringify(documentId)},url:location.href,timeOrigin:performance.timeOrigin` : ''}})}).catch(()=>{})}
      geometry();addEventListener('resize',geometry);setInterval(geometry,500);
      </script></body>`,
      ),
    );
  } catch (error) {
    console.error(String(error));
    response.writeHead(500);
    response.end(String(error));
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const sources = {};
for (const name of [
  'native-context-guard.mjs',
  'native-context-controller.js',
  'native-context-background.js',
  'native-context-tab-switch.mjs',
  'native-context-placeholder.html',
  'native-context-offscreen.js',
  'native-candidate-page.mjs',
  'verify-native-context-guard.mjs',
])
  sources[name] = digest(await readFile(new URL(name, import.meta.url)));
const offscreen = await readFile(
  new URL('native-context-offscreen.js', import.meta.url),
  'utf8',
);
await writeFile(
  path.join(extension, 'offscreen.js'),
  offscreen +
    '\n' +
    (await readFile(path.join(extension, 'offscreen.js'), 'utf8')),
);
await cp(
  fileURLToPath(new URL('native-context-controller.js', import.meta.url)),
  path.join(extension, 'fixture-controller.js'),
);
await cp(
  fileURLToPath(new URL('native-context-tab-switch.mjs', import.meta.url)),
  path.join(extension, 'fixture-tab-switch.mjs'),
);
await cp(
  fileURLToPath(new URL('native-context-placeholder.html', import.meta.url)),
  path.join(extension, 'fixture-placeholder.html'),
);
await writeFile(
  path.join(extension, 'fixture-context-config.json'),
  JSON.stringify({
    origin,
    mode,
    tabSwitchProbe,
    ...(ownedScan ? { ownedScan: true } : {}),
  }),
);
await writeFile(
  path.join(extension, 'fixture-controller.html'),
  '<!doctype html><title>Native context evidence collector</title><p>Start through the real toolbar. This page only collects evidence and performs the selected interruption.</p><script src="fixture-controller.js"></script>',
);
const startup = `\n;chrome.runtime.onInstalled.addListener(()=>{void(async()=>{
  await chrome.tabs.create({url:chrome.runtime.getURL('fixture-controller.html'),active:false});
  const tab=await chrome.tabs.create({url:${JSON.stringify(origin + '/')},active:true});
  await chrome.windows.update(tab.windowId,{state:'normal',width:900,height:650});
  ${ownedScan ? `await fetch(${JSON.stringify(origin + '/original-tab')},{method:'POST',body:JSON.stringify({at:Date.now(),tabId:tab.id,windowId:tab.windowId,index:tab.index,url:tab.url ?? ${JSON.stringify(origin + '/')}})});` : ''}
})().catch(error=>fetch(${JSON.stringify(origin + '/progress')},{method:'POST',body:JSON.stringify({startupError:String(error)})}));});\n`;
await writeFile(
  path.join(extension, 'background.js'),
  (await readFile(
    new URL('native-context-background.js', import.meta.url),
    'utf8',
  )) +
    '\n' +
    (await readFile(path.join(extension, 'background.js'), 'utf8')) +
    startup,
);
environment = {
  mode,
  tabSwitchProbe,
  ...(ownedScan
    ? {
        ownedScan: true,
        authorization:
          'The user must prepare the disposable scan tab through the real product UI, then open the real toolbar on that tab and authorize capture. The fixture never prepares or starts scans.',
      }
    : {}),
  ...(tabSwitchProbe
    ? {
        hypothesis: 'POST_DETACH_INFOBAR_CONTAINER_REBIND',
        productionAcceptance: false,
      }
    : {}),
  origin,
  preparedAt: new Date().toISOString(),
  headless: false,
  playwrightAttached: false,
  machine: {
    platform: process.platform,
    arch: arch(),
    release: release(),
    cpuModel: cpus()[0]?.model,
    logicalCpus: cpus().length,
  },
  requestedWindow: { width: 900, height: 650 },
  extensionBuild: {
    productionSha256,
    ...(ownedScan ? { embeddedScannerBuildSha256 } : {}),
    instrumentedSha256: await hashDirectory(extension),
    algorithm: 'sha256 over sorted filename, NUL, bytes, NUL',
    fixtureSourceSha256: sources,
  },
  instrumentation:
    'Copied-build passive Worker message/real-stream, debugger-detach reply and persisted restoration-phase observers; no frame reads, modification or synthesis. Separate extension page queries actual state and performs the selected zoom/resize or STOP. Production manifest and permissions unchanged. Actual toolbar authorization required. Instrumented run is not a throughput benchmark.' +
    (tabSwitchProbe
      ? ' OPT-IN HYPOTHESIS: one guarded fixture-owned blank-tab switch at detach+5200ms, within the existing covered workspace. Any PASS describes this intervention, never unmodified production cleanup.'
      : ''),
  clock: 'Date.now receipt/action epochs, not exact compositor exposure time.',
};
await writeFile(
  path.join(evidenceDirectory, 'environment-start.json'),
  JSON.stringify(environment, null, 2),
);
console.log(
  JSON.stringify({
    evidenceDirectory,
    origin,
    mode,
    tabSwitchProbe,
    productionSha256,
    prepareOnly,
  }),
);
if (prepareOnly) {
  await new Promise((resolve) => server.close(resolve));
} else {
  browser = spawn(
    chromium.executablePath(),
    [
      `--user-data-dir=${path.join(evidenceDirectory, 'browser-profile')}`,
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  console.log(
    JSON.stringify({
      pid: browser.pid,
      next: ownedScan
        ? `Wait for originalSnapshotReady. In the original page toolbar choose autonomous/genuine hover and prepare the owned scan through its real UI button. Wait for ownedPreparationObserved, then on the resulting scan tab open the toolbar again and start. Do not interact during observation. ${mode === 'cancel' ? 'The fixture only sends STOP after real compact frames.' : 'The fixture waits for natural completion and never sends STOP.'}`
        : 'Use the real toolbar: autonomous mode; enable genuine hover for cancel. Do not interact with the browser during observation. Ctrl+C closes only this isolated browser.',
    }),
  );
  async function stop() {
    if (stopping) return;
    stopping = true;
    browser.kill('SIGTERM');
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
  browser.on('exit', () => void stop());
}
