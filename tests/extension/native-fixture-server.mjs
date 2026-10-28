// Manual toolbar-capture gate. Static by default; optional tiny low-contrast motion.
// The opt-in candidate mode changes one 2 × 2 CSS-pixel signal. DENSE adds
// a separately disclosed low-contrast GPU workload during the control observation.
// Start this script, then use the real browser toolbar to authorise/start FlashGuard.

import { readFile } from 'node:fs/promises';

import { interactiveFixture } from './interactive-fixture.mjs';

import { nativeCandidatePage } from './native-candidate-page.mjs';

import {
  recheckEvidencePath,
  recheckMediaPath,
} from './native-encoded-recheck-source.mjs';

import { appendLoopTrace } from './native-loop-page.mjs';

import {
  encodedPageSource,
  serveEncodedAsset,
} from './native-encoded-source.mjs';

import { createServer } from 'node:http';
/** Serve deterministic fixture assets locally and return the server for explicit shutdown. */
export function createNativeFixtureServer({
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
}) {
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

  return { server };
}
