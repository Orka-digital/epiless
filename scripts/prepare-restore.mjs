import { readFile, writeFile } from 'node:fs/promises';
import { archiveKey, unseal, prepareRestore } from './operations/archive.mjs';
const args = process.argv.slice(2);
if (
  args.length !== 6 ||
  args[0] !== '--backup' ||
  args[2] !== '--ledger' ||
  args[4] !== '--out'
)
  throw new Error(
    'Usage: pnpm backup:prepare-restore --backup PRIVATE.backup --ledger FRESH.ledger --out PRIVATE.sql',
  );
const key = archiveKey(process.env.EPI_LESS_BACKUP_KEY);
const backup = unseal(await readFile(args[1]), key);
const ledger = unseal(await readFile(args[3]), key);
const sql = prepareRestore(backup, ledger);
await writeFile(args[5], sql, { mode: 0o600, flag: 'wx' });
console.log(
  'Prepared private SQL for an EMPTY local database. All shares revoked, sessions/approvals expired, current erasures applied. No database was overwritten.',
);
