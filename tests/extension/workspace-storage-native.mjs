// Short API fixture only: no scanner START, debugger attach, capture token or
// video. The copied production manifest and its permissions stay byte-exact.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';

const production = fileURLToPath(
  new URL('../../apps/chrome-extension/dist-advanced/', import.meta.url),
);
const directory = await mkdtemp(
  path.join(tmpdir(), 'epiless-workspace-storage-'),
);
const extension = path.join(directory, 'extension');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function hashDirectory(directory) {
  const hash = createHash('sha256');
  for (const name of (await readdir(directory)).sort())
    hash
      .update(name)
      .update('\0')
      .update(await readFile(path.join(directory, name)))
      .update('\0');
  return hash.digest('hex');
}
const productionSha256 = await hashDirectory(production);
await cp(production, extension, { recursive: true });
const manifestBytes = await readFile(path.join(production, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.permissions.includes('tabs'), false);
assert.equal(manifest.host_permissions, undefined);
await cp(
  fileURLToPath(new URL('native-context-placeholder.html', import.meta.url)),
  path.join(extension, 'fixture-placeholder.html'),
);
let receive;
const received = new Promise((resolve) => {
  receive = resolve;
});
const server = createServer(async (request, response) => {
  response.setHeader('access-control-allow-origin', '*');
  if (request.method !== 'POST' || request.url !== '/result') {
    response.writeHead(404);
    response.end();
    return;
  }
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 30000) {
      response.writeHead(413);
      response.end();
      return;
    }
  }
  receive(JSON.parse(body));
  response.end('ok');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const background = `
chrome.runtime.onInstalled.addListener(() => { void (async () => {
  const before = {
    tabId: 11, windowId: 2, originalWindowId: 1, originalIndex: 2,
    originalViewport: { width: 900, height: 450, dpr: 2, scrollX: 0, scrollY: 0, visualScale: 1, visualOffsetLeft: 0, visualOffsetTop: 0 },
    originalWindow: { width: 900, height: 650, left: 22, top: 52 },
    detachedViewport: { width: 900, height: 507, dpr: 2 },
  };
  await chrome.storage.session.set({ workspace: before });
  const after = (await chrome.storage.session.get('workspace')).workspace;
  const evidence = {
    userAgent: navigator.userAgent, before, after,
    beforeKeys: Object.keys(before), afterKeys: Object.keys(after),
    beforeJson: JSON.stringify(before), afterJson: JSON.stringify(after),
    oldGuardEqual: JSON.stringify(before) === JSON.stringify(after),
    permissions: await chrome.permissions.getAll(),
  };
  await chrome.storage.session.remove('workspace');
  evidence.storageCleared = !(await chrome.storage.session.get('workspace')).workspace;
  await fetch(${JSON.stringify(origin + '/result')}, { method: 'POST', body: JSON.stringify(evidence) });
})(); });
`;
await writeFile(path.join(extension, 'background.js'), background);
const fixtureBytes = await readFile(fileURLToPath(import.meta.url));
await writeFile(path.join(directory, 'fixture.mjs'), fixtureBytes);
const ownershipUrl = new URL(
  '../../apps/chrome-extension/src/viewport-workspace.ts',
  import.meta.url,
);
const ownershipBytes = await readFile(ownershipUrl);
await writeFile(path.join(directory, 'viewport-workspace.ts'), ownershipBytes);
const { sameWorkspaceOwnership } = await tsImport(
  ownershipUrl.href,
  import.meta.url,
);
let browser, timer;
try {
  browser = spawn(
    chromium.executablePath(),
    [
      `--user-data-dir=${path.join(directory, 'profile')}`,
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const result = await Promise.race([
    received,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Storage fixture timed out')),
        15000,
      );
    }),
  ]);
  const evidence = {
    scope:
      'Headless chrome.storage.session roundtrip only; no tab actions, scanner, capture, debugger or native layout claim.',
    headless: true,
    playwrightAttached: false,
    productionSha256,
    manifestSha256: sha(manifestBytes),
    fixtureScriptSha256: sha(await readFile(fileURLToPath(import.meta.url))),
    placeholderSha256: sha(
      await readFile(
        new URL('native-context-placeholder.html', import.meta.url),
      ),
    ),
    generatedBackgroundSha256: sha(background),
    correctedOwnership: {
      scope:
        'Pure source comparator on real returned values, not the copied production background bundle.',
      sourceSha256: sha(ownershipBytes),
      equal: sameWorkspaceOwnership(result.after, result.before),
    },
    manifestUnchanged: (
      await readFile(path.join(extension, 'manifest.json'))
    ).equals(manifestBytes),
    result,
  };
  await writeFile(
    path.join(directory, 'evidence.json'),
    JSON.stringify(evidence, null, 2),
  );
  assert.equal(await hashDirectory(production), productionSha256);
  assert.equal(evidence.manifestUnchanged, true);
  assert.equal(result.permissions.permissions.includes('tabs'), false);
  assert.deepEqual(result.permissions.origins ?? [], []);
  assert.deepEqual(result.after, result.before);
  assert.equal(result.oldGuardEqual, false);
  assert.equal(result.storageCleared, true);
  assert.equal(evidence.correctedOwnership.equal, true);
  assert.equal(sha(await readFile(ownershipUrl)), sha(ownershipBytes));
  console.log(
    JSON.stringify(
      {
        status: 'REPRODUCED',
        directory,
        userAgent: result.userAgent,
        beforeKeys: result.beforeKeys,
        afterKeys: result.afterKeys,
        oldGuardEqual: result.oldGuardEqual,
      },
      null,
      2,
    ),
  );
} finally {
  clearTimeout(timer);
  if (browser && browser.exitCode === null) {
    browser.kill('SIGTERM');
    await new Promise((resolve) => browser.once('exit', resolve));
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
