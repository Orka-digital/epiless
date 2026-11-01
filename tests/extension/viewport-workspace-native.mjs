import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { viewportWorkspaceProgram } from './viewport-workspace-program.mjs';

// No Playwright/CDP connection is made to this browser: it would itself occupy
// the debugger whose non-displacement is one of the production safety checks.
const directory = await mkdtemp(
  path.join(tmpdir(), 'flashguard-native-workspace-'),
);
const extension = path.join(directory, 'extension');
await mkdir(extension);
let browser;
let resultResolve;
const result = new Promise((resolve) => {
  resultResolve = resolve;
});
const server = createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/result') {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10000) request.destroy();
    });
    request.on('end', () => {
      resultResolve(JSON.parse(body));
      response.end('ok');
    });
    return;
  }
  response.setHeader('content-type', 'text/html');
  response.end(`<!doctype html><style>button{margin:40px;padding:25px}button:hover{outline:3px solid #999}.compact{display:none}@media(max-width:650px){.compact{display:block}}</style>
    <button type="button" aria-controls="panel" aria-expanded="false">Show details</button><div id="panel" hidden>Static details</div>
    <button class="compact" type="button" aria-controls="compact-panel" aria-expanded="false" onclick="this.setAttribute('aria-expanded','true');document.querySelector('#compact-panel').hidden=false">Compact details</button><div id="compact-panel" hidden>Static compact details</div>
    <script>document.documentElement.dataset.clicks='0';document.querySelector('button').onmouseover=(event)=>document.documentElement.dataset.trusted=String(event.isTrusted);document.querySelector('button').onclick=()=>document.documentElement.dataset.clicks='1';</script>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const esbuild = createRequire(
  new URL('../../apps/chrome-extension/package.json', import.meta.url),
)('esbuild');
let timeout;
try {
  await esbuild.build({
    entryPoints: [
      fileURLToPath(
        new URL('../../apps/chrome-extension/src/content.ts', import.meta.url),
      ),
    ],
    outfile: path.join(extension, 'content.js'),
    bundle: true,
    format: 'iife',
    target: 'chrome116',
  });
  await esbuild.build({
    stdin: {
      resolveDir: fileURLToPath(
        new URL('../../apps/chrome-extension/src/', import.meta.url),
      ),
      contents: viewportWorkspaceProgram(origin),
    },
    outfile: path.join(extension, 'background.js'),
    bundle: true,
    format: 'iife',
    target: 'chrome116',
  });
  await writeFile(
    path.join(extension, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'FlashGuard isolated pointer test',
      version: '1.0.0',
      permissions: ['scripting', 'debugger'],
      host_permissions: ['http://127.0.0.1/*'],
      background: { service_worker: 'background.js' },
    }),
  );
  browser = spawn(
    chromium.executablePath(),
    [
      `--user-data-dir=${path.join(directory, 'profile')}`,
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      ...(process.env.EPI_LESS_FIXTURE_HEADFUL === '1'
        ? []
        : ['--headless=new']),
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--no-sandbox',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const value = await Promise.race([
    result,
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error('Native pointer fixture timed out')),
        45000,
      );
      browser.once('error', reject);
      browser.once('exit', (code) =>
        reject(new Error(`Native pointer browser exited: ${code}`)),
      );
    }),
  ]);
  assert.equal(value.error, undefined, JSON.stringify(value));
  assert.equal(value.pointer?.achieved, true, JSON.stringify(value));
  assert.equal(value.evidence.hover, true);
  assert.equal(value.evidence.trusted, 'true');
  assert.equal(value.evidence.clicks, '0');
  assert.equal(value.attached, false);
  assert.equal(value.duringSession, true);
  assert.equal(value.compact.width, 600);
  assert.equal(value.compact.height, 400);
  assert.deepEqual(value.restored, value.beforeResize);
  assert.equal(value.restoredWindow.width, value.original.width);
  assert.equal(value.restoredWindow.height, value.original.height);
  assert.equal(value.inactive, true);
  assert.equal(value.inactiveAfter, true);
  assert.equal(value.foregroundAfter, value.foreground);
  assert.deepEqual(value.responsive, {
    width: 600,
    height: Math.min(400, value.beforeInactive.height),
    dpr: value.beforeInactive.dpr,
  });
  assert.equal(value.compactAction.achieved, true, JSON.stringify(value));
  assert.equal(value.inactiveHover.achieved, true, JSON.stringify(value));
  assert.deepEqual(value.afterEmulation, {
    compactVisible: true,
    expanded: 'true',
    panelVisible: true,
    hover: true,
  });
  assert.deepEqual(value.remembered, value.beforeInactive);
  assert.deepEqual(
    value.cleared,
    value.beforeInactive,
    JSON.stringify(value.restoreSteps),
  );
  assert.ok(
    !value.activity.some(
      (e) =>
        e.event === 'active' &&
        e.tabId === value.workspaceState.tab.id &&
        e.windowId === value.original.id,
    ),
    JSON.stringify(value.activity),
  );
  assert.ok(
    !value.activity.some(
      (e) =>
        e.event === 'focus' && e.windowId === value.workspaceState.window.id,
    ),
    JSON.stringify(value.activity),
  );
  assert.equal(value.workspaceState.window.focused, false);
  assert.equal(value.workspaceState.tab.active, true);
  assert.equal(value.workspaceState.focused.id, value.originalForeground.id);
  assert.equal(value.lastFocused.id, value.originalForeground.id);
  assert.equal(value.outerAfter.width, value.original.width);
  assert.equal(value.outerAfter.height, value.original.height);
  console.log(
    `Native interaction fixture passed: actual Chrome CDP mouse movement, trusted event and CSS :hover; physical compact viewport restored; background tab moved into an unfocused physical ${value.responsive.width}×${value.responsive.height} workspace within original ${value.beforeInactive.width}×${value.beforeInactive.height} CSS extent, revealed and activated its responsive control, supported real hover, and restored CSS/window geometry and original tab placement; activation/focus events prove no foreground exposure. Debugger detached. Static local content; tabCapture pixels/continuity are not asserted.`,
  );
} finally {
  clearTimeout(timeout);
  if (browser && browser.exitCode === null) {
    browser.kill('SIGTERM');
    await new Promise((resolve) => {
      const force = setTimeout(() => {
        browser.kill('SIGKILL');
        resolve();
      }, 3000);
      browser.once('exit', () => {
        clearTimeout(force);
        resolve();
      });
    });
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  // Chromium child processes can finish profile writes after the parent exits.
  // Retry transient cleanup errors, but still fail if the directory remains.
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
