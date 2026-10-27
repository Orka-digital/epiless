/** Numeric review only: no engine import, playback, changed labels or baseline updates. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const commit = 'ef78542aad496827f25064f57aaf13d6a741ba75';
const repository = 'https://github.com/traceRERC/pse-test-media';
const reference = new URL('../tests/reference/', import.meta.url);
const sha256 = (/** @type {import("node:crypto").BinaryLike} */ bytes) =>
  createHash('sha256').update(bytes).digest('hex');
const sign = (/** @type {number} */ value) =>
  value > 0 ? 1 : value < 0 ? -1 : 0;
const dot = (/** @type {number[]} */ a, /** @type {number[]} */ b) =>
  a[0] * b[0] + a[1] * b[1];

/**
 * @param {number[]} rgb
 */
function color(rgb) {
  const [r, g, b] = rgb.map((byte) => {
    const encoded = byte / 255;
    return encoded <= 0.04045
      ? encoded / 12.92
      : ((encoded + 0.055) / 1.055) ** 2.4;
  });
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const divisor = x + 15 * y + 3 * z;
  assert(divisor > 0, 'These selected sources have defined chromaticity');
  return {
    luminance: 0.2126 * r + 0.7152 * g + 0.0722 * b,
    redFraction: r / (r + g + b),
    uv: [(4 * x) / divisor, (9 * y) / divisor],
  };
}

/**
 * @param {string} csv
 */
function parse(csv) {
  const [header, ...rows] = csv.trimEnd().split(/\r?\n/);
  assert.equal(header, 'sRGBA,r,g,b,a');
  return rows.map((row, i) => {
    const cells = row.split(',');
    assert(cells.length === 5 && cells.every((cell) => /^\d+$/.test(cell)));
    const [frame, r, g, b, a] = cells.map(Number);
    assert.equal(frame, i + 1);
    assert.equal(a, 255);
    assert([r, g, b].every((value) => value <= 255));
    const rgb = [r, g, b];
    return { frame, timeMs: (i * 1000) / 30, rgb, ...color(rgb) };
  });
}

/**
 * @param {ReturnType<typeof parse>} samples
 */
function changes(samples) {
  return samples.filter(
    (sample, i) =>
      !i ||
      sample.rgb.some(
        (value, channel) => value !== samples[i - 1].rgb[channel],
      ),
  );
}

/** Adjacent extrema after removing equal samples; never sum distinct reversals. */
/**
 * @param {ReturnType<typeof parse>} points
 */
function extrema(points) {
  return points.filter(
    (point, i) =>
      !i ||
      i === points.length - 1 ||
      sign(point.luminance - points[i - 1].luminance) !==
        sign(points[i + 1].luminance - point.luminance),
  );
}

/**
 * @param {ReturnType<typeof parse>} points
 */
function generalEdges(points) {
  return points.slice(1).map((point, i) => {
    const previous = points[i];
    const delta = point.luminance - previous.luminance;
    const darker = Math.min(point.luminance, previous.luminance);
    return {
      fromFrame: previous.frame,
      toFrame: point.frame,
      endMs: point.timeMs,
      delta,
      darker,
      qualifies: Math.abs(delta) >= 0.1 && darker < 0.8,
    };
  });
}

/**
 * @param {ReturnType<typeof parse>} samples
 * @param {boolean} detailed
 */
function generalTrace(samples, detailed) {
  const points = changes(samples);
  const peaks = extrema(points);
  // A one-second interval whose initial state is actually held by source frame 3.
  // This is a step-plot calculation, not an inserted/duplicated video frame.
  const startMs = 90;
  const endMs = 1090;
  const initial = samples.findLast((sample) => sample.timeMs <= startMs);
  assert(initial);
  assert((samples.at(-1)?.timeMs ?? -Infinity) >= endMs);
  const windowPoints = [
    initial,
    ...points.filter((point) => point.timeMs > startMs && point.timeMs < endMs),
  ];
  const windowEdges = generalEdges(extrema(windowPoints));
  assert.equal(windowEdges.length, 7);
  assert(windowEdges.every((edge) => edge.qualifies));
  assert(
    windowEdges.every(
      (edge, i) => !i || edge.delta * windowEdges[i - 1].delta < 0,
    ),
  );
  if (!detailed) {
    const edges = generalEdges(peaks);
    return {
      extremaFrames: peaks.map((point) => point.frame),
      qualifyingExtremumEdges: edges.filter((edge) => edge.qualifies).length,
      minimumExtremumDelta: Math.min(
        ...edges.map((edge) => Math.abs(edge.delta)),
      ),
      maximumDarkerLuminance: Math.max(...edges.map((edge) => edge.darker)),
      witnessWindow: {
        startMs,
        endMs,
        initialHeldSourceFrame: initial.frame,
        initialHeldSourceFrameTimestampMs: initial.timeMs,
        qualifyingAlternatingTransitionFrames: windowEdges.map(
          (edge) => edge.toFrame,
        ),
        transitionEndTimesMs: windowEdges.map((edge) => edge.endMs),
      },
    };
  }
  return {
    changePoints: points.map(({ frame, timeMs, rgb, luminance }) => ({
      frame,
      timeMs,
      rgb,
      luminance,
    })),
    adjacentStepEdges: generalEdges(points),
    extremaFrames: peaks.map((point) => point.frame),
    extremumEdges: generalEdges(peaks),
    witnessWindow: {
      startMs,
      endMs,
      initialHeldSourceFrame: initial.frame,
      initialHeldSourceFrameTimestampMs: initial.timeMs,
      qualifyingAlternatingTransitions: windowEdges,
    },
  };
}

/**
 * @param {ReturnType<typeof parse>[number]} a
 * @param {ReturnType<typeof parse>[number]} b
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
 * @param {ReturnType<typeof parse>} samples
 */
function redTrace(samples) {
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
