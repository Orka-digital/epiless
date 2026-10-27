import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
if (process.env.GITHUB_REF_NAME !== `v${packageJson.version}`) {
  throw new Error('Release tag must exactly match package.json version.');
}
if (process.argv.includes('--built')) {
  const extension = JSON.parse(
    await readFile('apps/chrome-extension/dist/manifest.json', 'utf8'),
  );
  if (extension.version !== packageJson.version)
    throw new Error('Built extension manifest and release versions differ.');
}
const ownership = await readFile('.github/CODEOWNERS', 'utf8');
if (!ownership.split('\n').some((line) => /^\*\s+@[a-zA-Z0-9]/.test(line))) {
  throw new Error(
    'Configure actual repository code owners before an official release.',
  );
}
