import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const LATEST_CACHE =
  'public, max-age=300, stale-while-revalidate=3600, stale-if-error=86400';
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
/** Local static-origin fixture, intentionally has no web API/database dependency. */
/**
 * @param {string} directory
 */
export function feedServer(directory) {
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Access-Control-Allow-Origin', '*');
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const latest = path === '/feeds/stable/latest.json';
    if (
      !['GET', 'HEAD'].includes(request.method ?? '') ||
      (!latest &&
        !/^\/feeds\/stable\/releases\/\d{6,16}\/(?:manifest|rules\.[a-f0-9]{64})\.json$/.test(
          path,
        ))
    ) {
      response.writeHead(404, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    try {
      const root = await realpath(directory);
      const file = await realpath(resolve(root, `.${path}`));
      if (!file.startsWith(root + sep)) throw new Error('Out of scope');
      const bytes = await readFile(file);
      if (bytes.length > 10 * 1024 * 1024)
        throw new Error('Oversized feed object');
      const etag = `"${createHash('sha256').update(bytes).digest('hex')}"`;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader(
        'Cache-Control',
        latest ? LATEST_CACHE : IMMUTABLE_CACHE,
      );
      response.setHeader('ETag', etag);
      if (request.headers['if-none-match'] === etag)
        response.writeHead(304).end();
      else {
        response.setHeader('Content-Length', bytes.length);
        response
          .writeHead(200)
          .end(request.method === 'HEAD' ? undefined : bytes);
      }
    } catch {
      response.writeHead(404, { 'Cache-Control': 'no-store' }).end();
    }
  });
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  if (process.argv.length !== 3)
    throw new Error('Usage: pnpm feed:preview DIRECTORY');
  const port = Number(process.env.FEED_PORT || 4388);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Invalid FEED_PORT');
  const server = feedServer(process.argv[2]);
  server.listen(port, '127.0.0.1', () =>
    console.log(
      `Local static feed: http://127.0.0.1:${port}/feeds/stable/latest.json (not a CDN or blocker)`,
    ),
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => server.close());
}
