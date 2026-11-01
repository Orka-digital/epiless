import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tsImport } from 'tsx/esm/api';
import { cpus, totalmem, release } from 'node:os';

// In-memory RGBA only. No visual flashing playback. These timings deliberately
// exclude fixture generation, GPU capture, colour conversion, canvas and IPC.
/** @type {import("./probe-types.js").EngineModule} */
const { FrameAnalyzer, ENGINE_VERSION, combinedMaskFieldAnalysis } =
  await tsImport('../src/index.ts', import.meta.url);
async function engineHash() {
  const hash = createHash('sha256'),
    root = new URL('../src/', import.meta.url);
  for (const name of (await readdir(root))
    .filter((n) => n.endsWith('.ts'))
    .sort())
    hash.update(name).update(await readFile(new URL(name, root)));
  return hash.digest('hex');
}
const before = await engineHash(),
  results = [];
const trials = 3,
  frames = 90,
  warmup = 10;
const percentile = (/** @type {number[]} */ values, /** @type {number} */ p) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.ceil(values.length * p) - 1)
  ];
/**
 * @param {number} pixel
 */
function textureHash(pixel) {
  let value = Math.imul(pixel ^ 0x6d2b79f5, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}
for (const [width, height] of [
  [320, 180],
  [640, 360],
  [1280, 720],
  [1920, 1080],
]) {
  for (const fixture of [
    'unchanged-rich',
    'single-pixel-pulse',
    'full-frame-pulses',
    'changing-gradient',
    'high-entropy-drift',
    'translated-multiscale-texture',
  ]) {
    const trialResults = [];
    for (let trial = 0; trial < trials; trial++) {
      global.gc?.();
      const baseline = process.memoryUsage().arrayBuffers;
      /** @type {import("./probe-types.js").AnalyzerProbe | undefined} */
      let analyzer = new FrameAnalyzer({ maxPixels: width * height });
      const preparationStarted = performance.now();
      analyzer.prepare(width, height);
      const preparationMs = performance.now() - preparationStarted;
      /** @type {Uint8Array | undefined} */
      let rgba = new Uint8Array(width * height * 4);
      let texture;
      if (fixture === 'translated-multiscale-texture') {
        texture = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const pixel = y * width + x,
              value = Math.round(
                100 +
                  35 * Math.sin(x / 61) +
                  25 * Math.cos(y / 47) +
                  20 * Math.sin((x + y) / 113) +
                  (textureHash(pixel) & 7),
              );
            texture[pixel * 4] = value;
            texture[pixel * 4 + 1] = value + 15;
            texture[pixel * 4 + 2] = value - 10;
            texture[pixel * 4 + 3] = 255;
          }
      }
      const times = [];
      let peak = baseline;
      for (let frame = 0; frame < frames; frame++) {
        for (let pixel = 0; pixel < width * height; pixel++) {
          const i = pixel * 4,
            changing = fixture === 'changing-gradient',
            pulse =
              fixture === 'full-frame-pulses' ||
              (fixture === 'single-pixel-pulse' &&
                pixel === (height - 2) * width + width - 2);
          if (fixture === 'high-entropy-drift') {
            const noise = textureHash(pixel);
            rgba[i] = ((noise & 255) + frame * 3) & 255;
            rgba[i + 1] = (((noise >>> 8) & 255) + frame * 3) & 255;
            rgba[i + 2] = (((noise >>> 16) & 255) + frame * 3) & 255;
          } else if (texture) {
            const source =
              (Math.floor(pixel / width) * width +
                (((pixel % width) + frame) % width)) *
              4;
            rgba[i] = texture[source];
            rgba[i + 1] = texture[source + 1];
            rgba[i + 2] = texture[source + 2];
          } else if (pulse)
            rgba[i] =
              rgba[i + 1] =
              rgba[i + 2] =
                Math.floor((frame * 8) / 60) % 2 ? 255 : 0;
          else {
            const value = (pixel + (changing ? frame * 3 : 0)) % 256;
            rgba[i] = value;
            rgba[i + 1] = (value + 71) % 256;
            rgba[i + 2] = (value + 133) % 256;
          }
          rgba[i + 3] = 255;
        }
        const started = performance.now();
        analyzer.pushFrame({
          rgba,
          width,
          height,
          timestampMs: (frame * 1000) / 60,
        });
        const elapsed = performance.now() - started;
        if (frame >= warmup) times.push(elapsed);
        peak = Math.max(peak, process.memoryUsage().arrayBuffers);
      }
      const report = analyzer.finish();
      trialResults.push({
        preparationMs,
        meanMs: times.reduce((a, b) => a + b, 0) / times.length,
        p95Ms: percentile(times, 0.95),
        maxMs: Math.max(...times),
        framesOver16_7Ms: times.filter((t) => t > 1000 / 60).length,
        peakArrayBufferDeltaBytes: Math.max(0, peak - baseline),
        boundedStateBytes: report.quality.spatial?.stateBytes,
        candidates: report.findings.length,
        completeDiagnosticCandidates: report.findings.filter(
          (f) => f.diagnostic?.complete,
        ).length,
      });
      // Release large buffers before the next trial and its memory baseline.
      // eslint-disable-next-line no-useless-assignment
      analyzer = undefined;
      // eslint-disable-next-line no-useless-assignment -- Release the previous frame buffer.
      rgba = undefined;
      texture = undefined;
    }
    results.push({
      width,
      height,
      fixture,
      medianMeanFrameMs: percentile(
        trialResults.map((r) => r.meanMs),
        0.5,
      ),
      trials: trialResults,
    });
  }
}
const masks = [];
for (const fixture of ['disjoint-islands', 'dense-irregular', 'full-frame']) {
  const width = 1920,
    height = 1080;
  const mask = Uint8Array.from({ length: width * height }, (_, pixel) =>
    fixture === 'full-frame' ||
    (fixture === 'disjoint-islands'
      ? (pixel % width) % 96 < 16 && Math.floor(pixel / width) % 80 < 16
      : (Math.imul(pixel, 1664525) >>> 0) % 7 < 3)
      ? 1
      : 0,
  );
  const times = [];
  let result;
  for (let trial = 0; trial < 35; trial++) {
    const started = performance.now();
    result = combinedMaskFieldAnalysis(mask, width, height, 341, 256);
    if (trial >= 5) times.push(performance.now() - started);
  }
  if (!result) throw new Error('No mask benchmark result');
  masks.push({
    fixture,
    width,
    height,
    fieldWidth: 341,
    fieldHeight: 256,
    samples: times.length,
    meanMs: times.reduce((a, b) => a + b, 0) / times.length,
    p95Ms: percentile(times, 0.95),
    maximumPixels: result.maximumPixels,
  });
}
if (before !== (await engineHash()))
  throw new Error('Engine source changed during benchmark');
console.log(
  JSON.stringify(
    {
      engineVersion: ENGINE_VERSION,
      recordedAt: new Date().toISOString(),
      engineSourceTreeSha256: before,
      benchmarkSourceSha256: createHash('sha256')
        .update(await readFile(new URL(import.meta.url)))
        .digest('hex'),
      additionalWorkloads:
        'high-entropy-drift uses seeded nonrepeating RGB values with gradual channel drift; translated-multiscale-texture uses procedural smooth spatial structure plus fine grain translated one exact pixel per frame. These are synthetic numeric workloads, not natural-video validation.',
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      osRelease: release(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      physicalMemoryBytes: totalmem(),
      gcAvailable: !!global.gc,
      trials,
      framesPerTrial: frames,
      warmupFrames: warmup,
      scope:
        'pushFrame CPU time only, with diagnostics enabled; no capture, canvas, IPC, browser FPS, conformance or safety claim',
      results,
      spatialMaskResults: masks,
    },
    null,
    2,
  ),
);
