import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { compareBaseline, validateDetection } from './validate-detection.mjs';

const corpus = fileURLToPath(
  new URL('../tests/reference/trace-pse-expanded/', import.meta.url),
);
const source = new URL('../packages/analysis-engine/src/', import.meta.url);
export async function engineTreeHash() {
  const hash = createHash('sha256');
  const names = (await readdir(source))
    .filter((name) => name.endsWith('.ts'))
    .sort();
  for (const name of names)
    hash.update(name).update(await readFile(new URL(name, source)));
  return hash.digest('hex');
}
/**
 * @param {import("./helper-types.js").TemporalReport} report
 * @param {import("./helper-types.js").TemporalReport} baseline
 */
export function compareExpandedBaseline(report, baseline) {
  if (
    report.sourceCases !== baseline.sourceCases ||
    JSON.stringify(report.unscored) !== JSON.stringify(baseline.unscored)
  )
    throw new Error(
      'Expanded source case coverage or source validity changed; review explicitly',
    );
  return compareBaseline(report, baseline);
}
export async function validateExpanded() {
  const before = await engineTreeHash();
  const report = await validateDetection(corpus, { expandedSource: true });
  if (before !== (await engineTreeHash()))
    throw new Error('Engine source changed during validation');
  return {
    ...report,
    engineSourceTreeSha256: before,
    scopeLimitations: [
      'Originally unseen externally authored patterns; after first encounter this is development regression evidence.',
      'No browser capture, spatial composition, display calibration or external certification is assessed by this numeric layer.',
      'Malformed original sources remain present, unmodified and unscored; they are not counted as correct detections.',
    ],
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    /** @type {Awaited<ReturnType<typeof validateExpanded>> & {baseline?: ReturnType<typeof compareExpandedBaseline>}} */
    const report = await validateExpanded();
    if (process.argv.includes('--check-baseline')) {
      const baseline = JSON.parse(
        (
          await readFile(
            new URL(
              '../tests/reference/trace-pse-expanded/first-encounter-0.4.0.json',
              import.meta.url,
            ),
            'utf8',
          )
        ).toString(),
      );
      report.baseline = compareExpandedBaseline(report, baseline);
      if (report.baseline.status !== 'NO_NEW_MISMATCHES') process.exitCode = 2;
    }
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
