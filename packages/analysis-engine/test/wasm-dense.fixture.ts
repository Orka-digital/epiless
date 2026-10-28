import { afterEach, expect, vi } from 'vitest';

import { FrameAnalyzer } from '../src/index.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

export function pixels(
  width: number,
  height: number,
  frame: number,
  uniform = false,
) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const phase = Math.floor(frame / 5) % 2;
  for (let p = 0; p < width * height; p++) {
    const n = uniform ? 10 : ((p * 37) ^ (p >>> 2)) & 63;
    rgba[p * 4] = n + phase * 180;
    rgba[p * 4 + 1] = n + phase * 180;
    rgba[p * 4 + 2] = n + phase * 180;
    if (p % 3 === 0 && !uniform) {
      rgba[p * 4] = phase ? 255 : 0;
      rgba[p * 4 + 1] = phase ? 0 : 255;
      rgba[p * 4 + 2] = 0;
    }
    rgba[p * 4 + 3] = 255;
  }
  return rgba;
}

export function state(analyzer: FrameAnalyzer) {
  const internal = analyzer as unknown as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of [
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
    'frameIndex',
    'representativeCount',
    'tilesPrepared',
    'invalid',
    'interrupted',
    'count',
    'first',
    'last',
    'gap',
  ])
    output[key] = internal[key];
  for (const kind of ['general', 'red']) {
    const history = internal[kind] as Record<string, unknown>;
    output[kind] = Object.fromEntries(
      Object.entries(history).filter(([key]) => key !== 'times'),
    );
  }
  return output;
}

export function sameState(
  actual: unknown,
  expected: unknown,
  label: string,
): void {
  if (ArrayBuffer.isView(expected)) {
    if (
      !ArrayBuffer.isView(actual) ||
      actual.constructor !== expected.constructor
    )
      throw new Error(`${label}: different typed-array kind`);
    const a = actual as unknown as ArrayLike<number>;
    const b = expected as unknown as ArrayLike<number>;
    if (a.length !== b.length) throw new Error(`${label}: different length`);
    for (let i = 0; i < a.length; i++)
      if (!Object.is(a[i], b[i]))
        throw new Error(`${label}[${i}]: ${a[i]} versus ${b[i]}`);
  } else if (expected && typeof expected === 'object') {
    const b = expected as Record<string, unknown>;
    const a = actual as Record<string, unknown>;
    expect(Object.keys(a)).toEqual(Object.keys(b));
    for (const key of Object.keys(b))
      sameState(a[key], b[key], `${label}/${key}`);
  } else if (!Object.is(actual, expected))
    throw new Error(`${label}: different scalar state`);
}
