import { readFileSync } from 'node:fs';
import { codeQualityFindings } from './code-quality-findings.mjs';
/** @type {import('./code-quality-findings.mjs').Finding[]} */
const baseline = JSON.parse(
  readFileSync('.code-quality-baseline.json', 'utf8'),
);
const current = await codeQualityFindings(process.cwd());
/** @param {import('./code-quality-findings.mjs').Finding} item */
const key = (item) => `${item.file}:${item.rule}:${item.signature}`;
const approved = new Map(baseline.map((item) => [key(item), item.value]));
const remaining = new Set(current.map(key));
const failures = current.filter(
  (item) =>
    !['complexity', 'max-depth', 'jsdoc/require-jsdoc'].includes(item.rule) ||
    item.value > (approved.get(key(item)) ?? 0),
);
const stale = baseline.filter((item) => !remaining.has(key(item)));
for (const item of failures)
  console.error(`${item.file}: ${item.label} [${item.signature}]`);
for (const item of stale)
  console.error(
    `${item.file}: remove resolved ${item.rule} baseline ${item.signature}`,
  );
if (failures.length || stale.length) process.exitCode = 1;
else
  console.log(
    `Code contracts: complexity ≤20, nesting ≤4 and exported function/class JSDoc; ${baseline.length} exact unchanged legacy findings tracked.`,
  );
