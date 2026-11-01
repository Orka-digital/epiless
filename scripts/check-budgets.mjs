import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const root = new URL('../apps/web/dist/client/', import.meta.url);
const assetRoot = new URL('_astro/', root);
const files = readdirSync(assetRoot);
const bytes = (/** @type {string} */ file) =>
  readFileSync(new URL(file, assetRoot));
const gzip = (/** @type {import("node:crypto").BinaryLike} */ data) =>
  gzipSync(data).length;
/**
 * @param {string} name
 * @param {number} actual
 * @param {number} maximum
 */
function budget(name, actual, maximum) {
  console.log(
    `${name}: ${(actual / 1024).toFixed(1)} / ${(maximum / 1024).toFixed(0)} KiB`,
  );
  if (actual > maximum)
    throw new Error(`${name} overschrijdt het afgesproken budget.`);
}
/**
 * @param {string} prefix
 */
function entry(prefix) {
  const name = files.find(
    (file) => file.startsWith(prefix + '.') && file.endsWith('.js'),
  );
  if (!name) throw new Error(`Build mist ${prefix}`);
  return name;
}
/**
 * @param {string} file
 */
function imports(file, visited = /** @type {Set<string>} */ (new Set())) {
  if (visited.has(file)) return visited;
  visited.add(file);
  const code = bytes(file).toString();
  for (const match of code.matchAll(
    /(?:from\s*|import\s*)["']\.\/([^"']+\.js)["']/g,
  ))
    imports(match[1], visited);
  return visited;
}
const cssBytes = files
  .filter((file) => file.endsWith('.css'))
  .reduce((total, file) => total + gzip(bytes(file)), 0);
budget('Gedeelde CSS', cssBytes, 30 * 1024);
// The tool interface uses system fonts; no font download is needed.
const fonts = files.filter((file) => file.endsWith('.woff2'));
if (fonts.length !== 0)
  throw new Error('De systeemlettertypes vereisen geen fontdownloads.');
const fontBytes = fonts.reduce((total, file) => total + bytes(file).length, 0);
budget('Eerste fonts', fontBytes, 100 * 1024);
for (const route of ['', 'docs/', 'voorbeeld/']) {
  const html = readFileSync(new URL(`${route}index.html`, root), 'utf8');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  if (html.includes('<astro-island'))
    throw new Error(`React mag niet laden op /${route}`);
  let js = 0;
  for (const [, attrs, code] of scripts) {
    const src = attrs.match(/src="\/_astro\/([^"]+)"/);
    if (src)
      js += [...imports(src[1])].reduce(
        (total, file) => total + gzip(bytes(file)),
        0,
      );
    else if (!/type="application\/(?:ld\+)?json"/.test(attrs))
      js += code ? gzip(code) : 0;
  }
  budget(`/${route} JavaScript`, js, 5 * 1024);
  budget(
    `/${route} HTML + assets`,
    gzip(html) + cssBytes + fontBytes + js,
    450 * 1024,
  );
}
for (const component of [
  'AuthForm',
  'PublishForm',
  'AbuseForm',
  'ModerationActions',
  'AccountActions',
]) {
  const deps = new Set([
    ...imports(entry(component)),
    ...imports(entry('client')),
  ]);
  const size = [...deps].reduce((total, file) => total + gzip(bytes(file)), 0);
  // Astro island bootstrap is checked from the actual SSR response in browser tests.
  budget(`${component} JS-chunks (bootstrap apart gemeten)`, size, 100 * 1024);
}
