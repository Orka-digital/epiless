import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
const vars = new URL('../apps/web/.dev.vars', import.meta.url);
if (!existsSync(vars)) throw new Error('Voer eerst pnpm setup:local uit.');
const origin = readFileSync(vars, 'utf8')
  .match(/^PUBLIC_APP_ORIGIN=(.+)$/m)?.[1]
  ?.trim();
if (!origin || !/^http:\/\/localhost:\d+$/.test(origin))
  throw new Error('Lokale preview vereist een localhost-origin in .dev.vars.');
const port = new URL(origin).port;
if (process.env.EPI_LESS_PORT && process.env.EPI_LESS_PORT !== port)
  throw new Error(
    'Voer EPI_LESS_PORT=<poort> pnpm setup:local uit om de lokale origin bij te werken.',
  );
await new Promise(
  /** @param {(value?: unknown) => void} resolve */ (resolve, reject) => {
    const probe = createServer();
    probe.once('error', () =>
      reject(
        new Error(
          `Poort ${port} is bezet. Kies een vrije EPI_LESS_PORT via pnpm setup:local.`,
        ),
      ),
    );
    probe.listen(Number(port), '127.0.0.1', () => probe.close(resolve));
  },
);
const child = spawn(
  'pnpm',
  [
    '--filter',
    '@epi-less/web',
    'exec',
    'astro',
    process.env.EPI_LESS_PREVIEW === 'true' ? 'preview' : 'dev',
    '--ignore-lock',
    '--host',
    '127.0.0.1',
    '--port',
    port,
  ],
  { stdio: 'inherit', env: { ...process.env, PUBLIC_APP_ORIGIN: origin } },
);
for (const signal of /** @type {NodeJS.Signals[]} */ (['SIGINT', 'SIGTERM']))
  process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));
