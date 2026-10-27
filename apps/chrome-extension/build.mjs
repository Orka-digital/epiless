import { build, context } from 'esbuild';
import { mkdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { scannerSourceFingerprint } from './source-fingerprint.mjs';
import { verifyDenseKernel } from '../../packages/analysis-engine/scripts/verify-wasm.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const watch = process.argv.includes('--watch');
// No compiler is needed for ordinary builds. Fail before publishing an identity
// or replacing dist if the checked-in kernel source/bytes/ABI are inconsistent.
await verifyDenseKernel();
const scannerBuildSha256 = watch
  ? undefined
  : await scannerSourceFingerprint(
      fileURLToPath(new URL('../..', import.meta.url)),
    );
const advanced =
  process.argv.includes('--advanced') ||
  process.env.EPI_LESS_ADVANCED_INTERACTIONS === '1';
const output = `${root}${advanced ? 'dist-advanced' : 'dist'}`;
const web = new URL(process.env.EPI_LESS_WEB_URL ?? 'http://localhost:4321');
if (
  web.pathname !== '/' ||
  web.search ||
  web.hash ||
  web.username ||
  web.password ||
  !['http:', 'https:'].includes(web.protocol)
)
  throw new Error('EPI_LESS_WEB_URL must be an HTTP(S) origin');
if (
  web.protocol !== 'https:' &&
  !['localhost', '127.0.0.1'].includes(web.hostname)
)
  throw new Error('Production publication requires HTTPS');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
/** @type {import("esbuild").BuildOptions} */
const buildOptions = {
  absWorkingDir: root,
  entryPoints: [
    'src/background.ts',
    'src/offscreen.ts',
    'src/analysis-worker.ts',
    'src/content.ts',
    'src/ui.tsx',
    'src/devtools.ts',
  ],
  bundle: true,
  outdir: output,
  format: 'iife',
  target: 'chrome116',
  minify: true,
  sourcemap: false,
  define: {
    __WEB_ORIGIN__: JSON.stringify(web.origin),
    __SCANNER_BUILD_SHA256__: scannerBuildSha256
      ? JSON.stringify(scannerBuildSha256)
      : 'undefined',
    'process.env.NODE_ENV': '"production"',
  },
};
await build(buildOptions);
const manifest = {
  manifest_version: 3,
  name: `epi-less Audit${advanced ? ' Advanced' : ''}`,
  description:
    'Autonomous local website observations with honest capture quality and a private audit history.',
  version: '0.1.0',
  minimum_chrome_version: '116',
  permissions: [
    'activeTab',
    'scripting',
    'tabCapture',
    'offscreen',
    'storage',
    ...(advanced ? ['debugger'] : []),
  ],
  optional_host_permissions: ['http://*/*', 'https://*/*'],
  background: { service_worker: 'background.js' },
  action: { default_popup: 'popup.html', default_title: 'epi-less Audit' },
  devtools_page: 'devtools.html',
  externally_connectable: { matches: [`${web.protocol}//${web.hostname}/*`] },
  content_security_policy: {
    extension_pages:
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'none'",
  },
};
await writeFile(
  `${output}/manifest.json`,
  `${JSON.stringify(manifest, null, 2)}\n`,
);
for (const page of ['popup', 'dashboard', 'panel']) {
  await writeFile(
    `${output}/${page}.html`,
    `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>epi-less Audit</title><link rel="stylesheet" href="ui.css"></head><body data-view="${page}"><div id="root"></div><script src="ui.js" defer></script></body></html>`,
  );
}
await writeFile(
  `${output}/offscreen.html`,
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>epi-less local capture</title></head><body><script src="offscreen.js"></script></body></html>',
);
await writeFile(
  `${output}/devtools.html`,
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>epi-less DevTools</title></head><body><script src="devtools.js"></script></body></html>',
);
await copyFile(`${root}public/ui.css`, `${output}/ui.css`);
console.log(
  `Built Chrome extension in ${output}; publication origin ${web.origin}`,
);
if (watch) {
  const watcher = await context(buildOptions);
  await watcher.watch();
  console.log(
    'Watching extension TypeScript. Reload the unpacked extension after a rebuild.',
  );
}
