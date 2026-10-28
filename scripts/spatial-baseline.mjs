import { readFile, readdir } from 'node:fs/promises';

import { resolve } from 'node:path';

import { fileURLToPath } from 'node:url';

import { hash } from './spatial-corpus.mjs';

export async function engineHashes() {
  const root = fileURLToPath(
    new URL('../packages/analysis-engine/src/', import.meta.url),
  );
  const entries = [];
  for (const file of (await readdir(root))
    .filter((name) => name.endsWith('.ts'))
    .sort())
    entries.push({
      path: file,
      sha256: hash(await readFile(resolve(root, file))),
    });
  return { files: entries, sha256: hash(JSON.stringify(entries)) };
}

/** Keep each reviewed disagreement visible; an improvement cannot offset a new case-level regression. */
/**
 * @param {import("./helper-types.js").SpatialReport} report
 * @param {import("./helper-types.js").SpatialReport} baseline
 */
export function compareSpatialBaseline(report, baseline) {
  for (const key of /** @type {const} */ ([
    'repository',
    'commit',
    'manifestSha256',
  ]))
    if (
      !report.reference?.[key] ||
      report.reference[key] !== baseline.reference?.[key]
    )
      throw new Error(
        'Spatial baseline reference changed; explicit baseline review required',
      );
  if (
    ![
      'ORIGINAL_SPATIAL_MASKS',
      'LOSSLESS_DECODED_SPATIAL_TEMPORAL_MEDIA',
    ].includes(report.scope) ||
    baseline.scope !== 'LOSSLESS_DECODED_SPATIAL_TEMPORAL_MEDIA'
  )
    throw new Error('Invalid spatial baseline scope');
  const knownMismatches = /** @type {string[]} */ ([]),
    improvements = /** @type {string[]} */ ([]),
    newMismatches = /** @type {string[]} */ ([]);
  const compare = (
    /** @type {string} */ id,
    /** @type {boolean} */ expected,
    /** @type {boolean} */ observed,
    /** @type {boolean} */ previous,
  ) => {
    if (
      typeof expected !== 'boolean' ||
      typeof observed !== 'boolean' ||
      typeof previous !== 'boolean'
    )
      throw new Error('Invalid baseline outcome');
    const wasMismatch = expected !== previous,
      isMismatch = expected !== observed;
    if (wasMismatch && isMismatch) knownMismatches.push(id);
    else if (isMismatch) newMismatches.push(id);
    else if (wasMismatch) improvements.push(id);
  };
  /** @template {{id:string}} T
   * @param {T[]} current
   * @param {T[]} recorded
   * @returns {[T,T][]}
   */
  const pairs = (current, recorded) => {
    if (
      !Array.isArray(current) ||
      !Array.isArray(recorded) ||
      current.length !== recorded.length
    )
      throw new Error('Baseline case set changed');
    const before = new Map(recorded.map((v) => [v.id, v]));
    if (
      before.size !== recorded.length ||
      new Set(current.map((v) => v.id)).size !== current.length
    )
      throw new Error('Duplicate baseline identity');
    return current.map((item) => {
      const old = before.get(item.id);
      if (!old) throw new Error('Baseline case identity changed');
      return [item, old];
    });
  };
  for (const [item, old] of pairs(report.masks, baseline.masks)) {
    if (
      item.expectedCandidate !== old.expectedCandidate ||
      item.decodedRgbaSha256 !== old.decodedRgbaSha256
    )
      throw new Error('Baseline mask label or decoded bytes changed');
    compare(
      `mask:${item.id}`,
      item.expectedCandidate,
      item.observedCandidate,
      old.observedCandidate,
    );
  }
  if (report.scope === 'LOSSLESS_DECODED_SPATIAL_TEMPORAL_MEDIA')
    for (const [item, old] of pairs(report.videos, baseline.videos)) {
      for (const field of /** @type {const} */ ([
        'kind',
        'upstreamJsonLabel',
        'jsonExpectedCandidate',
        'csvExpectedCandidate',
        'frameCount',
        'frameRate',
        'width',
        'height',
      ]))
        if (item[field] !== old[field])
          throw new Error('Baseline video label or sampling contract changed');
      for (const field of /** @type {const} */ ([
        'generatedFrameSha256',
        'decodedFrameSha256',
        'decodedFrameTimestampMs',
      ]))
        if (JSON.stringify(item[field]) !== JSON.stringify(old[field]))
          throw new Error('Baseline decoded media evidence changed');
      if (item.jsonExpectedCandidate !== null)
        compare(
          `video-json:${item.id}`,
          item.jsonExpectedCandidate,
          item.observedCandidate,
          old.observedCandidate,
        );
      compare(
        `video-csv:${item.id}`,
        item.csvExpectedCandidate,
        item.observedCandidate,
        old.observedCandidate,
      );
    }
  return {
    status: newMismatches.length ? 'REGRESSION' : 'NO_NEW_MISMATCHES',
    knownMismatches,
    improvements,
    newMismatches,
    baselineEngineSourceSha256: baseline.engineSource?.sha256,
  };
}
