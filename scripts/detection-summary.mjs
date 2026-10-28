/** Parse upstream samples without padding, scaling, colour conversion or playback. */
/**
 * @param {string} csv
 */
export function parseSamples(csv, { allowZeroBased = false } = {}) {
  const rows = csv.trimEnd().split(/\r?\n/);
  if (rows.shift() !== 'sRGBA,r,g,b,a')
    throw new Error('Unexpected upstream CSV header');
  if (rows.length < 2)
    throw new Error('Reference requires at least two frames');
  const start = allowZeroBased && rows[0].startsWith('0,') ? 0 : 1;
  return rows.map((row, index) => {
    const cells = row.split(',');
    if (cells.length !== 5 || cells.some((cell) => !/^\d+$/.test(cell)))
      throw new Error(`Malformed reference frame ${index + 1}`);
    const [frame, ...rgba] = cells.map(Number);
    if (frame !== index + start || rgba.some((value) => value > 255))
      throw new Error(`Invalid reference frame ${index + 1}`);
    return new Uint8Array(rgba);
  });
}

/**
 * @param {{expectedCandidate:boolean | null,observedCandidate:boolean}[]} cases
 */
export function summarizeCases(cases) {
  const truePositive = cases.filter(
    (item) => item.expectedCandidate && item.observedCandidate,
  ).length;
  const falseNegative = cases.filter(
    (item) => item.expectedCandidate && !item.observedCandidate,
  ).length;
  const falsePositive = cases.filter(
    (item) => !item.expectedCandidate && item.observedCandidate,
  ).length;
  const trueNegative = cases.filter(
    (item) => !item.expectedCandidate && !item.observedCandidate,
  ).length;
  const divide = (/** @type {number} */ n, /** @type {number} */ d) =>
    d ? n / d : null;
  return {
    cases: cases.length,
    truePositive,
    falseNegative,
    falsePositive,
    trueNegative,
    sensitivityOnSelectedCases: divide(
      truePositive,
      truePositive + falseNegative,
    ),
    precisionOnSelectedCases: divide(
      truePositive,
      truePositive + falsePositive,
    ),
    specificityOnSelectedCases: divide(
      trueNegative,
      trueNegative + falsePositive,
    ),
    mismatches: falseNegative + falsePositive,
  };
}

/** Allow reviewed disagreements and improvements, but reject new case-level regressions. */
/**
 * @param {import("./helper-types.js").TemporalReport} report
 * @param {import("./helper-types.js").TemporalReport} baseline
 */
export function compareBaseline(report, baseline) {
  const indexCases = (
    /** @type {import("./helper-types.js").TemporalReport} */ value,
  ) => {
    if (
      value?.scope !== 'NUMERIC_TEMPORAL_INTENSITY_PROJECTION' ||
      !Array.isArray(value.cases) ||
      !value.cases.length
    )
      throw new Error('Invalid baseline comparison report');
    const indexed = new Map();
    for (const item of value.cases) {
      if (
        typeof item.id !== 'string' ||
        !item.id ||
        indexed.has(item.id) ||
        !['GENERAL_FLASH', 'RED_FLASH'].includes(item.kind) ||
        typeof item.expectedCandidate !== 'boolean' ||
        typeof item.observedCandidate !== 'boolean'
      )
        throw new Error('Invalid or duplicate baseline comparison case');
      indexed.set(item.id, item);
    }
    return indexed;
  };
  for (const field of ['repository', 'commit', 'manifestSha256']) {
    if (
      typeof report?.reference?.[field] !== 'string' ||
      !report.reference[field] ||
      report.reference[field] !== baseline?.reference?.[field]
    )
      throw new Error(
        'Baseline reference corpus changed; review a new baseline explicitly',
      );
  }
  const current = indexCases(report),
    recorded = indexCases(baseline);
  if (current.size !== recorded.size)
    throw new Error('Baseline case set changed');
  const knownMismatches = [],
    improvements = [],
    newMismatches = [];
  for (const [id, item] of current) {
    const previous = recorded.get(id);
    if (
      !previous ||
      previous.kind !== item.kind ||
      previous.expectedCandidate !== item.expectedCandidate
    )
      throw new Error('Baseline case identity, type or expected label changed');
    // Derive mismatch status from observations, never trust stored agreement or totals.
    const wasMismatch =
      previous.expectedCandidate !== previous.observedCandidate;
    const isMismatch = item.expectedCandidate !== item.observedCandidate;
    if (isMismatch && !wasMismatch) newMismatches.push(id);
    else if (isMismatch) knownMismatches.push(id);
    else if (wasMismatch) improvements.push(id);
  }
  return {
    status: newMismatches.length ? 'REGRESSION' : 'NO_NEW_MISMATCHES',
    baselineEngineVersion: baseline.engineVersion,
    baselineEngineSourceSha256: baseline.engineSourceSha256,
    referenceManifestSha256: baseline.reference.manifestSha256,
    knownMismatches: knownMismatches.sort(),
    improvements: improvements.sort(),
    newMismatches: newMismatches.sort(),
  };
}
