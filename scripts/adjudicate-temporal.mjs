/** Numeric review only: no engine import, playback, changed labels or baseline updates. */
import assert from 'node:assert/strict';

import { createHash } from 'node:crypto';

import { readFile } from 'node:fs/promises';

import { pathToFileURL } from 'node:url';
import { parse } from './temporal-colors.mjs';
import { generalTrace } from './temporal-general.mjs';
import { redTrace } from './temporal-red.mjs';

const commit = 'ef78542aad496827f25064f57aaf13d6a741ba75';

const repository = 'https://github.com/traceRERC/pse-test-media';

const reference = new URL('../tests/reference/', import.meta.url);

const sha256 = (/** @type {import("node:crypto").BinaryLike} */ bytes) =>
  createHash('sha256').update(bytes).digest('hex');

export async function adjudicateTemporal() {
  const corpora = [];
  const cases = [];
  for (const corpus of ['trace-pse', 'trace-pse-expanded']) {
    const root = new URL(`${corpus}/`, reference);
    const manifestBytes = await readFile(new URL('manifest.json', root));
    /** @type {import("./helper-types.js").TemporalManifest} */
    const manifest = JSON.parse(manifestBytes.toString());
    assert.equal(manifest.upstreamCommit, commit);
    assert.equal(manifest.upstreamRepository, repository);
    corpora.push({ corpus, manifestSha256: sha256(manifestBytes) });
    const selected = manifest.files.filter((entry) =>
      /\/(?:[ly]03[1-9]_srgba|dr011_multi|s014_multi)\.csv$/.test(entry.path),
    );
    assert.equal(selected.length, corpus === 'trace-pse' ? 2 : 18);
    for (const entry of selected) {
      const bytes = await readFile(new URL(`upstream/${entry.path}`, root));
      assert.equal(
        sha256(bytes),
        entry.sha256,
        `Original source changed: ${entry.path}`,
      );
      assert.ok(entry.kind !== 'provenance');
      assert.equal(entry.framesPerSecond, 30);
      assert.equal(entry.expectedCandidate, false);
      const samples = parse(bytes.toString());
      const general = entry.kind === 'GENERAL_FLASH';
      cases.push({
        corpus,
        id: entry.path,
        sourceUrl: `${repository}/blob/${commit}/${entry.path}`,
        csvSha256: entry.sha256,
        upstreamExpectedCandidate: entry.expectedCandidate,
        classification: general
          ? 'STAIRCASE_STEP_VS_EXTREMUM_DISAGREEMENT'
          : entry.path.endsWith('/dr011_multi.csv')
            ? 'SEVEN_TRANSITIONS_WITH_WEAK_EIGHTH_RETURN'
            : 'SATURATION_AFTER_MONOTONE_PLATEAU_AMBIGUITY',
        trace: general
          ? generalTrace(samples, corpus === 'trace-pse')
          : redTrace(samples),
      });
    }
  }
  return {
    schemaVersion: 1,
    scope: 'NUMERIC_DISAGREEMENT_ADJUDICATION',
    conformanceEstablished: false,
    engineExecuted: false,
    source: { repository, commit, corpora },
    counts: {
      originalContextCases: 2,
      expandedDisagreements: 18,
      staircaseCasesAcrossBoth: 18,
      redCases: 2,
    },
    method: [
      'Recompute linear sRGB, relative luminance and CIE 1976 u-prime/v-prime from unchanged opaque source CSVs at 30 fps.',
      'General: compare adjacent steps with adjacent extrema after equal samples and monotone internal steps are removed; retain a one-second witness with an actually held initial source state.',
      'Red: show immediate comparisons and an explicitly non-independent reconstruction of retained-anchor excursions. Dot products show opposition; the standards do not specify this vector implementation.',
      'Seven-edge witnesses describe numeric threshold evidence; they do not score area, physical display, biological risk or normative conformity.',
      'This does not execute the engine, revise upstream labels, alter historical scores, or constitute independent expert certification.',
    ],
    cases,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.log(JSON.stringify(await adjudicateTemporal(), null, 2));
}
