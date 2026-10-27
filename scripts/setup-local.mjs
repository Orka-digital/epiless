import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const web = fileURLToPath(new URL('../apps/web/', import.meta.url));
const vars = new URL('../apps/web/.dev.vars', import.meta.url);
const port = Number(process.env.EPI_LESS_PORT || 4321);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('EPI_LESS_PORT moet tussen 1024 en 65535 liggen.');
if (!existsSync(vars)) {
  writeFileSync(
    vars,
    [
      'ENVIRONMENT=development',
      `PUBLIC_APP_ORIGIN=http://localhost:${port}`,
      `BETTER_AUTH_SECRET=${randomBytes(36).toString('base64url')}`,
      `SHARE_TOKEN_SECRET=${randomBytes(36).toString('base64url')}`,
      'LOCAL_TURNSTILE_FIXTURE=true',
      'TURNSTILE_SITE_KEY=local-development-only',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  console.log('Lokale configuratie aangemaakt; secrets worden niet afgedrukt.');
}
if (process.env.EPI_LESS_PORT) {
  const current = readFileSync(vars, 'utf8');
  if (
    !/^ENVIRONMENT=development$/m.test(current) ||
    !/^PUBLIC_APP_ORIGIN=http:\/\/localhost:\d+$/m.test(current)
  )
    throw new Error(
      'Poortwijziging vereist een lokale development-configuratie.',
    );
  writeFileSync(
    vars,
    current.replace(
      /^PUBLIC_APP_ORIGIN=.*$/m,
      `PUBLIC_APP_ORIGIN=http://localhost:${port}`,
    ),
    { mode: 0o600 },
  );
}
const result = spawnSync(
  'pnpm',
  ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'flashguard', '--local'],
  { cwd: web, stdio: 'inherit', env: { ...process.env, CI: 'true' } },
);
if (result.status !== 0) process.exit(result.status || 1);
console.log(
  'Lokale D1 gereed. pnpm dev gebruikt de origin uit apps/web/.dev.vars. Er is geen productiedata of demo-account aangemaakt.',
);
