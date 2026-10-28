import { hashDirectory } from './native-build-identity.mjs';
// Manual real-toolbar integration fixture. Never attaches Playwright/CDP and
// never sends START/RESUME or requests a capture token. See --prepare-only.
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { nativeCandidatePage } from './native-candidate-page.mjs';

/** Serve the bounded native fixture and persist its actual browser evidence. */
export function createNativeContextServer({
  ownedScan,
  mode,
  evidenceDirectory,
  production,
  productionSha256,
  getEnvironment,
}) {
  const geometry = [];
  let originalTab, originalDocumentId;
  return createServer(async (request, response) => {
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
          value.environment = getEnvironment();
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
}
