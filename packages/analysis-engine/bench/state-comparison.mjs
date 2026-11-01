import assert from 'node:assert/strict';
import { readQualityField } from './quality-probe.mjs';
/**
 * @param {import("./probe-types.js").NumericArray | undefined} a
 * @param {import("./probe-types.js").NumericArray | undefined} b
 * @param {string} label
 */
function sameArray(a, b, label) {
  assert.equal(a?.constructor, b?.constructor, label);
  if (a === undefined) return;
  assert.ok(b);
  assert.equal(a.length, b.length, label);
  const aa = Buffer.from(a.buffer, a.byteOffset, a.byteLength),
    bb = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  if (!aa.equals(bb)) {
    if (a instanceof Float64Array) {
      for (let i = 0; i < a.length; i++)
        assert.ok(Object.is(a[i], b[i]), `${label}[${i}]:${a[i]} vs${b[i]}`);
    } else assert.deepEqual(b, a, label);
  }
}
/**
 * @param {import("./probe-types.js").AnalyzerProbe} a
 * @param {import("./probe-types.js").AnalyzerProbe} b
 * @param {string} label
 * @param {number} embeddedDelta
 */
export function assertState(a, b, label, embeddedDelta) {
  for (const key of /** @type {const} */ ([
    'frameTimes',
    'luminance',
    'direction',
    'redAnchor',
    'saturated',
    'redPending',
    'redDu',
    'redDv',
    'redStart',
    'previousRgb',
    'representatives',
    'queue',
    'previousFrame',
    'tileUniform',
    'tilePeers',
    'tileDependents',
    'tileCandidates',
    'tileCandidateCounts',
  ]))
    sameArray(a[key], b[key], `${label}/${key}`);
  for (const kind of /** @type {const} */ (['general', 'red'])) {
    const aa = a[kind],
      bb = b[kind];
    for (const key of kind === 'general'
      ? /** @type {const} */ ([
          'starts',
          'count',
          'next',
          'active',
          'activeSeeds',
        ])
      : /** @type {const} */ ([
          'starts',
          'previous',
          'tripleEndingPrevious',
          'candidateStarts',
          'active',
          'activeSeeds',
        ]))
      sameArray(aa[key], bb[key], `${label}/${kind}/${key}`);
    for (const key of /** @type {const} */ ([
      'hasActive',
      'activeSeedCount',
      'activeCount',
      'earliestActive',
      'firstActive',
      'lastActive',
    ]))
      assert.equal(bb[key], aa[key], `${label}/${kind}/${key}`);
  }
  for (const key of /** @type {const} */ ([
    'frameIndex',
    'representativeCount',
    'tilesPrepared',
    'invalid',
    'interrupted',
    'count',
    'first',
    'last',
    'gap',
  ]))
    assert.equal(
      readQualityField(b, key),
      readQualityField(a, key),
      `${label}/${key}`,
    );
  for (const key of /** @type {const} */ ([
    'frameTimes',
    'luminance',
    'direction',
    'redAnchor',
    'saturated',
    'redPending',
    'redDu',
    'redDv',
    'redStart',
    'previousRgb',
    'representatives',
  ]))
    assert.equal(
      b[key].buffer,
      b.getInputRgba()?.buffer,
      `${label}/${key} shared WASM view`,
    );
  assert.equal(
    b.stateBytes,
    a.stateBytes + b.wasmArena.extraAllocatedBytes + embeddedDelta,
    `${label}/explicit memory accounting`,
  );
}
