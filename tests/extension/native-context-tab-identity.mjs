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

const production = fileURLToPath(
  new URL('../../apps/chrome-extension/dist-advanced/', import.meta.url),
);
const directory = await mkdtemp(
  path.join(tmpdir(), 'epiless-fixture-tab-identity-'),
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
  const evidence = { at: Date.now(), permissions: await chrome.permissions.getAll(), steps: [] };
  let target, placeholder;
  try {
    const nonce = crypto.randomUUID();
    const targetUrl = chrome.runtime.getURL('fixture-placeholder.html') + '#source-' + nonce;
    const placeholderUrl = chrome.runtime.getURL('fixture-placeholder.html') + '#probe-' + nonce;
    evidence.expected = { targetUrl, placeholderUrl };
    target = await chrome.tabs.create({ url: targetUrl, active: true });
    placeholder = await chrome.tabs.create({ windowId: target.windowId, openerTabId: target.id, url: placeholderUrl, active: false });
    evidence.created = { target, placeholder };
    evidence.readiness = [];
    for (let attempt = 0; attempt < 50; attempt++) {
      const current = await chrome.tabs.get(placeholder.id);
      evidence.readiness.push({ at: Date.now(), current });
      if (current.url === placeholderUrl && !current.pendingUrl) break;
      if (current.pendingUrl !== placeholderUrl || current.url !== undefined)
        throw new Error('UNEXPECTED_PENDING_EXTENSION_URL');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const snapshot = async (stage) => {
      const tabs = await chrome.tabs.query({ windowId: target.windowId });
      evidence.steps.push({ stage, at: Date.now(), tabs });
      const owned = tabs.find(tab => tab.id === placeholder.id);
      if (owned?.url !== placeholderUrl || owned.openerTabId !== target.id || owned.windowId !== target.windowId || owned.pinned || owned.groupId !== -1)
        throw new Error('EXACT_EXTENSION_URL_IDENTITY_NOT_READABLE');
      return owned;
    };
    await snapshot('before-activate');
    await chrome.tabs.update(placeholder.id, { active: true });
    if (!(await snapshot('placeholder-active')).active) throw new Error('PLACEHOLDER_NOT_ACTIVE');
    await chrome.tabs.update(target.id, { active: true });
    if ((await snapshot('source-reactivated')).active) throw new Error('SOURCE_NOT_ACTIVE');
    await chrome.tabs.remove(placeholder.id);
    evidence.remainingTabs = await chrome.tabs.query({ windowId: target.windowId });
    evidence.status = 'PASS';
  } catch (error) { evidence.status = 'FAIL'; evidence.error = String(error); }
  evidence.endedAt = Date.now();
  await fetch(${JSON.stringify(origin + '/result')}, { method: 'POST', body: JSON.stringify(evidence) });
})(); });
`;
await writeFile(path.join(extension, 'background.js'), background);
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
        () => reject(new Error('API identity fixture timed out')),
        15000,
      );
    }),
  ]);
  const evidence = {
    scope:
      'Headless extension API identity check only; no scanner, capture, native layout or focus-restoration claim.',
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
  assert.equal(result.status, 'PASS', result.error);
  assert.equal(
    result.remainingTabs.some(
      (tab) => tab.id === result.created.placeholder.id,
    ),
    false,
  );
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        directory,
        manifestUnchanged: true,
        permissions: result.permissions,
        stages: result.steps.map(({ stage, at }) => ({ stage, at })),
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
