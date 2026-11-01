/** Numeric review only: no engine import, playback, changed labels or baseline updates. */

import { changes, dot } from './temporal-colors.mjs';

/**
 * @param {ReturnType<typeof import('./temporal-colors.mjs').parse>[number]} a
 * @param {ReturnType<typeof import('./temporal-colors.mjs').parse>[number]} b
 */
function redEdge(a, b) {
  const vector = [b.uv[0] - a.uv[0], b.uv[1] - a.uv[1]];
  const distance = Math.hypot(...vector);
  const saturatedEndpoint = a.redFraction >= 0.8 || b.redFraction >= 0.8;
  return {
    fromFrame: a.frame,
    toFrame: b.frame,
    endMs: b.timeMs,
    vector,
    distance,
    saturatedEndpoint,
    qualifies: saturatedEndpoint && distance > 0.2,
  };
}

/**
 * @param {ReturnType<typeof redEdge>[]} edges
 */
function annotateOpposition(edges) {
  return edges.map((edge, i) => ({
    ...edge,
    dotWithPreviousQualifiedVector: i
      ? dot(edges[i - 1].vector, edge.vector)
      : null,
  }));
}

/**
 * @param {ReturnType<typeof redEdge>[]} edges
 */
function sevenEdgeWitness(edges) {
  for (let i = 6; i < edges.length; i++) {
    const seven = edges.slice(i - 6, i + 1);
    if (
      seven[6].endMs - seven[0].endMs < 1000 &&
      seven.every((edge, j) => !j || dot(seven[j - 1].vector, edge.vector) < 0)
    )
      return seven.map((edge) => edge.toFrame);
  }
  return null;
}

/**
 * @param {ReturnType<typeof import('./temporal-colors.mjs').parse>} samples
 */
export function redTrace(samples) {
  const points = changes(samples);
  const adjacent = points.slice(1).map((point, i) => redEdge(points[i], point));
  const qualified = adjacent.filter((edge) => edge.qualifies);
  // An explanatory reconstruction of the current retained-anchor policy, not a
  // second standards oracle. Keep the immediate comparisons alongside it.
  const retained = [];
  let anchor = points[0];
  for (const point of points.slice(1)) {
    const edge = redEdge(anchor, point);
    if (edge.qualifies) {
      retained.push(edge);
      anchor = point;
    }
  }
  return {
    changePoints: points.map(({ frame, timeMs, rgb, redFraction, uv }) => ({
      frame,
      timeMs,
      rgb,
      redFraction,
      uv,
    })),
    adjacentEdges: adjacent,
    adjacentQualifiedEdges: annotateOpposition(qualified),
    adjacentSevenOpposingEdgeFrames: sevenEdgeWitness(qualified),
    retainedAnchorEdges: annotateOpposition(retained),
    retainedAnchorSevenOpposingEdgeFrames: sevenEdgeWitness(retained),
  };
}
