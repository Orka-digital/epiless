import { spawn } from 'node:child_process';

const names = [
  'BETTER_AUTH_SECRET',
  'SHARE_TOKEN_SECRET',
  'TURNSTILE_SECRET_KEY',
  'RESEND_API_KEY',
];
const values = Object.fromEntries(
  names.map((name) => {
    const value = process.env[name];
    if (!value || value.length < (name.endsWith('_SECRET') ? 32 : 16))
      throw new Error(`Missing or invalid protected secret: ${name}`);
    return [name, value];
  }),
);
if (/^[123]x0{10,}/.test(values.TURNSTILE_SECRET_KEY))
  throw new Error('Turnstile test secrets cannot be deployed');
if (process.argv.includes('--validate-only')) {
  console.log(
    'Required production runtime secrets are present; values were not printed.',
  );
} else {
  const child = spawn(
    'pnpm',
    ['--filter', '@epi-less/web', 'exec', 'wrangler', 'secret', 'bulk'],
    { stdio: ['pipe', 'inherit', 'inherit'], env: process.env },
  );
  child.stdin.end(JSON.stringify(values));
  child.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}
