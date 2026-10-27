import { readdir, readFile, access } from 'node:fs/promises';
import { resolve, dirname, extname, relative } from 'node:path';

const root = process.cwd();
const skipped = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-advanced',
  '.astro',
  '.wrangler',
  '.output',
  '.playwright-mcp',
  'artifacts',
  'test-results',
  'playwright-report',
  'coverage',
]);
/** @type {string[]} */
const files = [];
/**
 * @param {string} directory
 */
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skipped.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else files.push(path);
  }
}
await walk(root);
const failures = [];
for (const required of [
  'README.md',
  'LICENSE',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'GOVERNANCE.md',
  'CODE_OF_CONDUCT.md',
  'docs/IMPLEMENTATION.md',
  'docs/DELIVERY.md',
  'CHANGELOG.md',
  'docs/P0-ACCEPTANCE.md',
  'docs/development.md',
  'docs/self-hosting.md',
  'docs/operations.md',
  'docs/costs.md',
  'docs/abuse-protection.md',
]) {
  try {
    await access(resolve(root, required));
  } catch {
    failures.push(`Missing ${required}`);
  }
}
for (const file of files.filter(
  (file) =>
    extname(file) === '.md' &&
    // Byte-exact third-party excerpts retain links to unvendored upstream images.
    // Their provenance/integrity is checked by validate:detection instead.
    !relative(root, file).startsWith('tests/reference/trace-pse/upstream/') &&
    !relative(root, file).startsWith(
      'tests/reference/trace-pse-expanded/upstream/',
    ) &&
    !relative(root, file).startsWith(
      'tests/reference/trace-spatial/upstream/',
    ) &&
    // This frozen corpus has its own byte/label/dependency integrity harness.
    !relative(root, file).startsWith(
      'tests/reference/trace-alternating-heldout/upstream/',
    ) &&
    !file.endsWith('epi-less-audit.md'),
)) {
  const markdown = (await readFile(file, 'utf8')).replace(
    /^```[^\n]*\n[\s\S]*?^```\s*$/gm,
    '',
  );
  for (const match of markdown.matchAll(
    /\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g,
  )) {
    const target = match[1];
    if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue;
    const path = decodeURIComponent(target.split('#')[0]);
    if (!path) continue;
    try {
      await access(resolve(dirname(file), path));
    } catch {
      failures.push(`${relative(root, file)}: missing link ${target}`);
    }
  }
}
for (const file of files.filter(
  (file) =>
    file.includes('/.github/') && ['.yml', '.yaml'].includes(extname(file)),
)) {
  const yaml = await readFile(file, 'utf8');
  for (const match of yaml.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm)) {
    if (
      !match[1].startsWith('./') &&
      !/^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/.test(match[1])
    )
      failures.push(`${relative(root, file)}: unpinned Action ${match[1]}`);
  }
  if (/^\s*pull_request_target:/m.test(yaml))
    failures.push(
      `${relative(root, file)}: secret-bearing pull_request_target is not allowed`,
    );
}
for (const filename of ['ci.yml', 'security.yml']) {
  const yaml = await readFile(
    resolve(root, '.github/workflows', filename),
    'utf8',
  );
  if (!/^\s*pull_request:/m.test(yaml) || !/^\s*merge_group:/m.test(yaml))
    failures.push(
      `${filename}: pull requests and merge queues must run the same checks`,
    );
  if (yaml.includes('${{ secrets.'))
    failures.push(
      `${filename}: PR validation must not depend on repository secrets`,
    );
}
for (const file of files.filter((file) =>
  ['.json', '.ts', '.js', '.mjs', '.yml', '.yaml', '.md'].includes(
    extname(file),
  ),
)) {
  const text = await readFile(file, 'utf8');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))
    failures.push(
      `${relative(root, file)}: private signing material must not be committed`,
    );
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    'Documentation links, required files, workflow pins and secret-free PR contracts are valid.',
  );
