import { readFile } from 'node:fs/promises';
import { assessBudget } from './operations/budget.mjs';
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--input')
  throw new Error('Usage: pnpm ops:budget --input PRIVATE_USAGE.json');
const measured = JSON.parse(await readFile(args[1], 'utf8'));
const results = assessBudget(measured);
console.log(
  JSON.stringify(
    { measuredAt: measured.measuredAt, metrics: results },
    null,
    2,
  ),
);
if (results.some((result) => result.level === 'critical')) {
  console.error(
    '95% threshold reached: pause new uploads and inspect usage; keep reads and withdrawals available.',
  );
  process.exitCode = 2;
}
