import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

// Reconstruct exact measured sources, binary and harness in a NEW directory.
// This does not run a benchmark or compile anything. Run the printed command
// from the repository (with its installed tsx dependency) in an idle CPU slot.
const archiveBytes = await readFile(
  new URL(
    '../validation/wasm-dense-0.4.0-prototype-reconstruction.json.gz',
    import.meta.url,
  ),
);
const hash = (/** @type {import("node:crypto").BinaryLike} */ value) =>
  createHash('sha256').update(value).digest('hex');
assert.equal(
  hash(archiveBytes),
  'c4c4df10ea54f6f685a1a5ce09135bf2f6ace95591613402235cecf773e0c9ab',
);
const archive = JSON.parse(gunzipSync(archiveBytes).toString());
const outAt = process.argv.indexOf('--directory');
const directory =
  outAt >= 0
    ? resolve(process.argv[outAt + 1])
    : await mkdtemp(join(tmpdir(), 'epiless-wasm-replay-'));
if (outAt >= 0) await mkdir(directory); // Never reuse or overwrite an evidence directory.
for (const [name, text] of Object.entries(archive.files)) {
  assert.ok(!name.includes('..') && !name.startsWith('/'));
  // Original measured results remain in the archive. Fresh trials must create
  // their own exclusive files rather than accidentally reading historic output.
  if (name.endsWith('.json') && name !== 'wasm-manifest.json') continue;
  const path = join(directory, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, { flag: 'wx' });
}
for (const [name, base64] of Object.entries(archive.binary)) {
  assert.ok(!name.includes('..') && !name.startsWith('/'));
  const path = join(directory, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(base64, 'base64'), { flag: 'wx' });
}
await symlink('../baseline/src', join(directory, 'bench/baseline'), 'dir');
await symlink('../prototype/src', join(directory, 'bench/prototype'), 'dir');
const manifest = JSON.parse(
  (await readFile(join(directory, 'wasm-manifest.json'))).toString(),
);
assert.equal(
  hash(await readFile(join(directory, 'kernel/dense.c'))),
  manifest.kernelSourceSha256,
);
assert.equal(
  hash(await readFile(join(directory, 'kernel/dense.wasm'))),
  manifest.kernelWasmSha256,
);
assert.equal(
  hash(await readFile(join(directory, 'kernel/dense-repeat.wasm'))),
  manifest.kernelWasmSha256,
);
console.log(
  JSON.stringify(
    {
      directory,
      scope:
        'Reconstructed immutable prototype, not current production. Numeric buffers only. 126 full-state cases and 36 alternating CPU trials; do not run concurrently with native capture.',
      proof: [
        'node',
        '--import',
        'tsx',
        join(directory, 'bench/prove-wasm.mjs'),
      ],
      benchmark: [
        'node',
        '--import',
        'tsx',
        join(directory, 'bench/trials.mjs'),
      ],
      compiler: manifest,
    },
    null,
    2,
  ),
);
