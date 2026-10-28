import { build } from 'esbuild';
import {
  hashDirectory,
  readEmbeddedBuildIdentity,
} from './native-build-identity.mjs';
import { createNativeContextServer } from './native-context-server.mjs';
// Manual real-toolbar integration fixture. Never attaches Playwright/CDP and
// never sends START/RESUME or requests a capture token. See --prepare-only.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { arch, cpus, release, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const productionSha256 = await hashDirectory(production);
const embeddedScannerBuildSha256 = ownedScan
  ? await readEmbeddedBuildIdentity(production)
  : undefined;
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
// Request callbacks may observe startup before the environment has been collected.
// eslint-disable-next-line prefer-const
let environment;
let browser,
  stopping = false;
const server = createNativeContextServer({
  ownedScan,
  mode,
  evidenceDirectory,
  production,
  productionSha256,
  getEnvironment: () => environment,
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const sources = {};
for (const name of [
  'native-context-guard.mjs',
  'native-context-server.mjs',
  'native-build-identity.mjs',
  'native-context-proof-common.mjs',
  'native-owned-scan-proof.mjs',
  'native-owned-preparation-proof.mjs',
  'native-cancellation-proof.mjs',
  'native-tab-switch-proof.mjs',
  'native-context-controller.js',
  'native-context-original.js',
  'native-context-owned.js',
  'native-context-snapshot.js',
  'native-context-roundtrip.js',
  'native-context-probe.js',
  'native-context-poll.js',
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
await build({
  entryPoints: [
    fileURLToPath(new URL('native-context-controller.js', import.meta.url)),
  ],
  outfile: path.join(extension, 'fixture-controller.js'),
  bundle: true,
  format: 'iife',
  external: ['./fixture-tab-switch.mjs'],
  platform: 'browser',
  target: 'chrome120',
});
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
