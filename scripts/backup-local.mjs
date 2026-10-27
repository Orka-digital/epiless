import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveKey, seal } from './operations/archive.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--out')
  throw new Error('Usage: pnpm backup:local --out PRIVATE_DIRECTORY');
const key = archiveKey(process.env.EPI_LESS_BACKUP_KEY);
const out = resolve(args[1]);
await mkdir(out, { recursive: true, mode: 0o700 });
const temporary = await mkdtemp(join(tmpdir(), 'epiless-local-backup-'));
const cwd = fileURLToPath(new URL('../apps/web/', import.meta.url));
const execute = promisify(execFile);
const run = async (/** @type {string[]} */ args) =>
  (
    await execute('pnpm', ['exec', 'wrangler', 'd1', ...args, '--local'], {
      cwd,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, CI: 'true' },
    })
  ).stdout;
try {
  const capturedAt = Date.now();
  const dump = join(temporary, 'database.sql');
  await run(['export', 'DB', '--output', dump]);
  const result = JSON.parse(
    await run([
      'execute',
      'DB',
      '--command',
      'SELECT * FROM erasure_log ORDER BY created_at,id',
      '--json',
    ]),
  );
  const identityResult = JSON.parse(
    await run([
      'execute',
      'DB',
      '--command',
      "SELECT value FROM operations_meta WHERE key='database-instance'",
      '--json',
    ]),
  );
  const database = identityResult[0]?.results?.[0]?.value;
  if (typeof database !== 'string' || !/^[a-f0-9]{32}$/.test(database))
    throw new Error('Run local migrations before creating a recovery archive.');
  const common = { schemaVersion: 1, database, capturedAt };
  const name = new Date(capturedAt).toISOString().replaceAll(':', '-');
  await writeFile(
    join(out, `${name}.backup`),
    seal(
      { ...common, kind: 'database', sql: await readFile(dump, 'utf8') },
      key,
    ),
    { mode: 0o600, flag: 'wx' },
  );
  await writeFile(
    join(out, `${name}.ledger`),
    seal(
      {
        ...common,
        capturedAt: Date.now(),
        kind: 'erasure-ledger',
        events: result[0].results,
      },
      key,
    ),
    { mode: 0o600, flag: 'wx' },
  );
  console.log(
    'Encrypted local database and independent erasure ledger written. No remote resource was accessed.',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
