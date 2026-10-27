// Independent numerical worksheet, not a detector or a replacement label oracle.
// No engine imports. Never render source media or overwrite retained evidence.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL(
  '../tests/reference/trace-combo-heldout/',
  import.meta.url,
);
const hash = (/** @type {import("node:crypto").BinaryLike} */ value) =>
  createHash('sha256').update(value).digest('hex');
const source = await readFile(
  new URL('upstream/combo_flash_patterns/30fps/001fl.csv', root),
);
assert.equal(
  hash(source),
  '6d44cd2909679d107292e5eebad6971dc89e9fa6be448238731bfbfcdcf3a5f1',
);
const first = await readFile(new URL('first-encounter-0.4.0.json', root));
assert.equal(
  hash(first),
  'fe0da3e745899360b42bb1c7165ff6b15fdcf51f33988e3f85b63227f262ebe6',
);
/** @type {{cases:{id:string;channels:{kind:string;candidates:{startMs:number;endMs:number}[]}[]}[]}} */
const priorReport = JSON.parse(first.toString());
const recorded = priorReport.cases.find((item) =>
  item.id.endsWith('/001fl.csv'),
);
assert.ok(recorded);
const red = recorded.channels.find((item) => item.kind === 'RED_FLASH');
assert.ok(red);
assert.deepEqual(red.candidates, [{ startMs: 200, endMs: 900 }]);

// W3C Understanding SC 2.3.1: normalized/linearized sRGB, XYZ D65, CIE 1976 u'v'.
const linear = (/** @type {number} */ byte) => {
  const s = byte / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const rows = source.toString('utf8').trimEnd().split(/\r?\n/);
assert.equal(rows.shift(), 'sRGBA,r,g,b,a');
const frames = rows.map((row, index) => {
  const [frame, ...rgba] = row.split(',').map(Number);
  assert.equal(frame, index + 1);
  assert.equal(rgba.length, 4);
  assert.equal(rgba[3], 255);
  const [R, G, B] = rgba.slice(0, 3).map(linear);
  const X = 0.4124564 * R + 0.3575761 * G + 0.1804375 * B;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = 0.0193339 * R + 0.119192 * G + 0.9503041 * B;
  const denominator = X + 15 * Y + 3 * Z;
  return {
    frame,
    ptsMs: (index * 1000) / 30,
    rgba,
    linearRgb: [R, G, B],
    saturation: R / (R + G + B),
    uPrime: (4 * X) / denominator,
    vPrime: (9 * Y) / denominator,
    // Descriptive scalar only: this is not a prescribed current WCAG counter.
    redSignal: Math.max(0, R - G - B),
  };
});
const pair = (
  /** @type {number} */ fromFrame,
  /** @type {number} */ toFrame,
) => {
  const a = frames[fromFrame - 1],
    b = frames[toFrame - 1];
  const du = b.uPrime - a.uPrime,
    dv = b.vPrime - a.vPrime;
  const distance = Math.hypot(du, dv);
  return {
    fromFrame,
    toFrame,
    fromPtsMs: a.ptsMs,
    toPtsMs: b.ptsMs,
    fromRgb: a.rgba.slice(0, 3),
    toRgb: b.rgba.slice(0, 3),
    saturationInvolved: Math.max(a.saturation, b.saturation) >= 0.8,
    chromaticityDistance: distance,
    du,
    dv,
    clearsStatedColorThreshold:
      Math.max(a.saturation, b.saturation) >= 0.8 && distance > 0.2,
  };
};
const adjacentChanges = frames
  .slice(1)
  .flatMap((value, index) =>
    value.rgba
      .slice(0, 3)
      .some((channel, c) => channel !== frames[index].rgba[c])
      ? [pair(index + 1, index + 2)]
      : [],
  );
const qualifyingAdjacent = adjacentChanges.filter(
  (value) => value.clearsStatedColorThreshold,
);
assert.deepEqual(
  qualifyingAdjacent.map((value) => value.toFrame),
  [7, 8, 17, 18, 27, 28],
);

// Explicit source endpoint choices explaining the existing recorded result.
// This list is deliberately not a copied retained-anchor detection algorithm.
const explanatoryPairs = [
  [1, 7],
  [7, 8],
  [8, 17],
  [17, 18],
  [18, 22],
  [22, 25],
  [25, 27],
  [27, 28],
].map(([a, b]) => pair(a, b));
assert.ok(explanatoryPairs.every((value) => value.clearsStatedColorThreshold));
const oppositionDots = explanatoryPairs
  .slice(1)
  .map(
    (value, index) =>
      value.du * explanatoryPairs[index].du +
      value.dv * explanatoryPairs[index].dv,
  );
assert.ok(oppositionDots.every((value) => value < 0));
const lastPair = explanatoryPairs.at(-1);
assert.ok(lastPair);
assert.equal(lastPair.toPtsMs - explanatoryPairs[0].toPtsMs, 700);
assert.ok(!pair(21, 22).clearsStatedColorThreshold);
assert.ok(!pair(22, 23).clearsStatedColorThreshold);

// Ordinary scalar extrema, retaining the last frame of a plateau. These expose
// the trajectory; they neither select a normative chromaticity axis nor score it.
/** @type {typeof frames} */
const plateaus = [];
for (const frame of frames) {
  if (plateaus.at(-1)?.redSignal === frame.redSignal)
    plateaus[plateaus.length - 1] = frame;
  else plateaus.push(frame);
}
const redSignalTurningPoints = plateaus
  .filter(
    (value, index) =>
      index === 0 ||
      index === plateaus.length - 1 ||
      (value.redSignal - plateaus[index - 1].redSignal) *
        (plateaus[index + 1].redSignal - value.redSignal) <
        0,
  )
  .map(({ frame, ptsMs, rgba, redSignal }) => ({
    frame,
    ptsMs,
    rgb: rgba.slice(0, 3),
    redSignal,
  }));
const report = {
  schemaVersion: 1,
  sourceSha256: hash(source),
  firstEncounterSha256: hash(first),
  worksheetSha256: hash(await readFile(new URL(import.meta.url))),
  primaryFormula:
    'https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html',
  upstreamLabel:
    'https://github.com/traceRERC/pse-test-media/blob/ef78542aad496827f25064f57aaf13d6a741ba75/combo_flash_patterns/30fps/README.md',
  method:
    'Independent direct arithmetic from original RGB and 30 fps PTS. Saturated red requires linear R/(R+G+B)>=0.8; CIE1976 distance must exceed0.2. Adjacent changes and descriptive scalar extrema are reported separately. Explicit nonadjacent endpoint pairs explain the existing scanner policy; no engine imports, detector loop or normative pass/fail oracle is copied.',
  status: 'UNRESOLVED_TRANSITION_ENDPOINT_INTERPRETATION',
  originalExpectation: { GENERAL_FLASH: true, RED_FLASH: false },
  recordedRedCandidate: { startMs: 200, endMs: 900 },
  conclusion:
    'Immediate changed-frame comparisons yield six qualifying red edges. Retaining earlier saturated-red endpoints yields eight alternating qualifying vectors over700ms, including18→22 and22→25 where immediate21→22 and22→23 remain below0.2. This explains the extra candidate without a rounding-boundary discrepancy. W3C describes transitions between peaks and valleys, so adjacent-frame counting is not itself a normative oracle; its text does not prescribe this vector-anchor policy either. Keep the upstream negative label and the observed extra alert. Independent endpoint/duration adjudication remains open; no engine or label adjustment is established.',
  frames,
  adjacentChanges,
  qualifyingAdjacentTransitions: qualifyingAdjacent.length,
  redSignalTurningPoints,
  explanatoryPairs,
  oppositionDots,
  conformanceEstablished: false,
  passed: null,
};
assert.equal(
  process.argv.length,
  4,
  'Usage: node scripts/adjudicate-combo-red.mjs --output NEW.json',
);
assert.equal(process.argv[2], '--output');
await writeFile(process.argv[3], JSON.stringify(report, null, 2) + '\n', {
  flag: 'wx',
});
console.log(
  JSON.stringify(
    {
      status: report.status,
      qualifyingAdjacentTransitions: qualifyingAdjacent.length,
      explanatoryTransitions: explanatoryPairs.length,
      criticalPairs: [pair(21, 22), pair(18, 22), pair(22, 23), pair(22, 25)],
    },
    null,
    2,
  ),
);
