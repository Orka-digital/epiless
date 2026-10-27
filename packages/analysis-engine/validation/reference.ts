/**
 * Deliberately slow batch oracle for numeric STEP fixtures, independent of the
 * streaming detector, lookup table, transition ring and pairing dynamic program.
 * It recomputes sRGB/CIE coordinates and enumerates disjoint opposing pairs.
 * This is a regression reference, not an independently certified WCAG analyzer.
 * Source: https://www.w3.org/TR/WCAG22/#dfn-general-flash-and-red-flash-thresholds
 */
export type Rgb = readonly [number, number, number];
export interface NumericSample {
  time: number;
  rgb: Rgb;
  alpha?: number;
  sourceWidth?: number;
  interrupted?: boolean;
}
export interface ReferenceResult {
  general: boolean;
  red: boolean;
}
interface Color {
  y: number;
  u: number;
  v: number;
  red: boolean;
}
interface Edge {
  time: number;
  direction: readonly [number, number];
}
export function referenceColor(rgb: Rgb): Color {
  const channels = rgb.map((byte) => {
    const channel = byte / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  const [r, g, b] = channels;
  const xyz = [
    [0.4124564, 0.3575761, 0.1804375],
    [0.2126729, 0.7151522, 0.072175],
    [0.0193339, 0.119192, 0.9503041],
  ].map((row) =>
    row.reduce((sum, coefficient, i) => sum + coefficient * channels[i], 0),
  );
  const divisor = xyz[0] + 15 * xyz[1] + 3 * xyz[2];
  return {
    y: [0.2126, 0.7152, 0.0722].reduce(
      (sum, coefficient, i) => sum + coefficient * channels[i],
      0,
    ),
    u: divisor ? (4 * xyz[0]) / divisor : NaN,
    v: divisor ? (9 * xyz[1]) / divisor : NaN,
    red: r + g + b > 0 && r / (r + g + b) >= 0.8,
  };
}

function hasThreePairsAndContinuation(edges: Edge[]): boolean {
  const pairs: { first: number; last: number }[] = [];
  for (let i = 1; i < edges.length; i++) {
    const left = edges[i - 1].direction;
    const right = edges[i].direction;
    if (left[0] * right[0] + left[1] * right[1] < 0)
      pairs.push({ first: i - 1, last: i });
  }
  // Brute-force every allowed grouping; no streaming/ring/DP code is shared.
  const search = (
    from: number,
    count: number,
    last: number,
    started: number,
  ): boolean => {
    if (count === 3) {
      const continuation = edges[last + 1];
      if (!continuation || continuation.time - started >= 1000) return false;
      const previous = edges[last].direction;
      return (
        previous[0] * continuation.direction[0] +
          previous[1] * continuation.direction[1] <
        0
      );
    }
    for (let p = from; p < pairs.length; p++) {
      const pair = pairs[p];
      if (pair.first <= last) continue;
      const firstTime = count ? started : edges[pair.first].time;
      if (edges[pair.last].time - firstTime > 1000) continue;
      if (search(p + 1, count + 1, pair.last, firstTime)) return true;
    }
    return false;
  };
  return search(0, 0, -1, 0);
}

export function referenceStepSequence(
  samples: NumericSample[],
): ReferenceResult {
  let general = false;
  let red = false;
  let generalEdges: Edge[] = [];
  let redEdges: Edge[] = [];
  let previous: NumericSample | undefined;
  const finishSegment = () => {
    general ||= hasThreePairsAndContinuation(generalEdges);
    red ||= hasThreePairsAndContinuation(redEdges);
    generalEdges = [];
    redEdges = [];
  };
  for (const sample of samples) {
    if (
      !previous ||
      sample.interrupted ||
      sample.time <= previous.time ||
      sample.time - previous.time > 100 ||
      (sample.sourceWidth ?? 1) !== (previous.sourceWidth ?? 1) ||
      (sample.alpha ?? 255) !== 255 ||
      (previous.alpha ?? 255) !== 255
    ) {
      finishSegment();
      previous = sample;
      continue;
    }
    const a = referenceColor(previous.rgb);
    const b = referenceColor(sample.rgb);
    const dy = b.y - a.y;
    if (
      Math.abs(dy) >= 0.1 &&
      Math.min(a.y, b.y) < 0.8 &&
      (!generalEdges.length ||
        Math.sign(generalEdges.at(-1)!.direction[0]) !== Math.sign(dy))
    )
      generalEdges.push({ time: sample.time, direction: [dy, 0] });
    if (!Number.isFinite(a.u) || !Number.isFinite(b.u)) {
      red ||= hasThreePairsAndContinuation(redEdges);
      redEdges = [];
    } else if (Math.hypot(b.u - a.u, b.v - a.v) > 0.2 && (a.red || b.red)) {
      redEdges.push({ time: sample.time, direction: [b.u - a.u, b.v - a.v] });
    }
    previous = sample;
  }
  finishSegment();
  return { general, red };
}
