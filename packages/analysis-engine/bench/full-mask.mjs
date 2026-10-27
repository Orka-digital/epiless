import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus, release } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';

// Numeric buffers only: never play or render the flashing fixtures.
// An optional copied source directory permits the SAME harness on the exact
// before/after sources. It does not import a previously built engine bundle.
const sourceRoot = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL('../src/', import.meta.url));
const output = process.argv[3];
/** @type {import("./probe-types.js").EngineModule} */
const { FrameAnalyzer, ENGINE_VERSION } = await tsImport(
  pathToFileURL(resolve(sourceRoot, 'index.ts')).href,
  import.meta.url,
);
const hash = (/** @type {import("node:crypto").BinaryLike} */ bytes) =>
  createHash('sha256').update(bytes).digest('hex');
async function sourceHash() {
  const tree = createHash('sha256');
  for (const name of (await readdir(sourceRoot))
    .filter((name) => name.endsWith('.ts'))
    .sort())
    tree.update(name).update(await readFile(resolve(sourceRoot, name)));
  return tree.digest('hex');
}
const before = await sourceHash();
const width = 1920,
  height = 1080,
  frames = 90,
  warmup = 10,
  trials = 3;
/** @type {import("../src/spatial.js").VisualFieldCalibration} */
const visualField = {
  widthPx: 682,
  heightPx: 512,
  basis: 'W3C_CSS_REFERENCE',
  reference:
    'Synthetic benchmark assumption: fixed 341x256 CSS-pixel reference at DPR 2 and standard page zoom, mapped to 682x512 source pixels. No browser or physical display measurement.',
};
const results = [];
for (const fixture of [
  'full-frame-luminance',
  'full-frame-red-and-luminance',
]) {
  const measurements = [];
  for (let trial = 0; trial < trials; trial++) {
    global.gc?.();
    const analyzer = new FrameAnalyzer({
      maxPixels: width * height,
      visualField,
    });
    analyzer.prepare(width, height);
    const rgba = new Uint8Array(width * height * 4),
      times = [];
    for (let frame = 0; frame < frames; frame++) {
      const phase = Math.floor((frame * 8) / 60) % 2;
      for (let pixel = 0; pixel < width * height; pixel++) {
        const at = pixel * 4;
        if (fixture === 'full-frame-luminance')
          rgba[at] = rgba[at + 1] = rgba[at + 2] = phase ? 255 : 0;
        else {
          rgba[at] = phase ? 255 : 0;
          rgba[at + 1] = phase ? 0 : 255;
          rgba[at + 2] = 0;
        }
        rgba[at + 3] = 255;
      }
      const started = performance.now();
      analyzer.pushFrame({
        rgba,
        width,
        height,
        timestampMs: (frame * 1000) / 60,
      });
      if (frame >= warmup) times.push(performance.now() - started);
    }
    const result = analyzer.finish();
    assert.ok(result.quality.spatial);
    const sorted = [...times].sort((a, b) => a - b);
    measurements.push({
      meanMs: times.reduce((a, b) => a + b, 0) / times.length,
      p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
      maxMs: Math.max(...times),
      framesOver16_7Ms: times.filter((value) => value > 1000 / 60).length,
      boundedStateBytes: result.quality.spatial.stateBytes,
      // Exact whole-result fingerprints include findings, traces and quality.
      // Timing instrumentation lives outside the analyzer and is excluded.
      resultSha256: hash(JSON.stringify(result)),
      findings: result.findings.map((finding) => {
        assert.ok(finding.spatial?.visualField);
        assert.ok(finding.diagnostic);
        return {
          type: finding.type,
          maximumPixels: finding.spatial.visualField.maximumPixels,
          diagnosticComplete: finding.diagnostic.complete,
        };
      }),
    });
  }
  results.push({ fixture, trials: measurements });
}
if (before !== (await sourceHash()))
  throw new Error('Engine changed during benchmark; discard mixed-source run');
const report = {
  recordedAt: new Date().toISOString(),
  engineVersion: ENGINE_VERSION,
  engineSourceTreeSha256: before,
  benchmarkSourceSha256: hash(await readFile(fileURLToPath(import.meta.url))),
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  osRelease: release(),
  cpu: cpus()[0].model,
  width,
  height,
  frames,
  warmup,
  visualField,
  scope:
    'Numeric pushFrame CPU only with diagnostics and an explicit reference field; excludes fixture generation, capture, color conversion, IPC and rendering. Full masks only, not complex-workload throughput or a 60fps guarantee.',
  results,
};
const json = `${JSON.stringify(report, null, 2)}\n`;
if (output) await writeFile(output, json, { flag: 'wx' });
else process.stdout.write(json);
if (output)
  process.stdout.write(
    `${JSON.stringify({ output, engineSourceTreeSha256: before, results })}\n`,
  );
