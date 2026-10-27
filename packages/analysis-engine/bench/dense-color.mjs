import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { cpus, release, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { tsImport } from 'tsx/esm/api';

// Numeric buffers only: never render or play these fixtures. The default oracle
// is the immutable pre-optimization 4a tree, not a second current-engine import.
// Run from the repository using Node 24:
// node packages/analysis-engine/bench/dense-color.mjs --mode differential --output artifacts/dense-color-proof.json
// node packages/analysis-engine/bench/dense-color.mjs --output artifacts/dense-color-throughput.json
// --source DIR selects another candidate tree; --baseline-source DIR explicitly
// replaces the frozen baseline. --expected-source-sha256 HASH pins a candidate.
// All output paths are exclusive: historical evidence is never overwritten.
const script = fileURLToPath(import.meta.url);
const files = [
  'color-cache.ts',
  'diagnostic-history.ts',
  'index.ts',
  'spatial.ts',
];
const hash = (/** @type {import("node:crypto").BinaryLike} */ value) =>
  createHash('sha256').update(value).digest('hex');
const workloads = ['entropy', 'translation', 'gradient', 'pulse', 'sparse'];
const width = 1920,
  height = 1080,
  frames = 90,
  warmup = 15;
/** @type {import("../src/spatial.js").VisualFieldCalibration} */
const visualField = {
  widthPx: 682,
  heightPx: 512,
  basis: 'W3C_CSS_REFERENCE',
  reference:
    'Numeric profiling assumption: 341x256 CSS reference at DPR2 and standard zoom. No physical display measurement.',
};
/**
 * @param {string} source
 */
async function identity(source) {
  const tree = createHash('sha256');
  /** @type {Record<string,{bytes:number,sha256:string}>} */
  const entries = {};
  for (const name of (await readdir(source))
    .filter((name) => name.endsWith('.ts'))
    .sort()) {
    const bytes = await readFile(join(source, name));
    tree.update(name).update(bytes);
    entries[name] = { bytes: bytes.length, sha256: hash(bytes) };
  }
  return { treeSha256: tree.digest('hex'), files: entries };
}
/**
 * @param {string} source
 * @returns {Promise<import("./probe-types.js").EngineModule>}
 */
async function importAnalyzer(source) {
  return tsImport(
    pathToFileURL(join(source, 'index.ts')).href,
    import.meta.url,
  );
}
/**
 * @param {{source:string,expectedHash:string,workload:string,variant:string,trial:number}} input
 */
async function benchmarkOne(input) {
  const before = await identity(input.source);
  assert.equal(
    before.treeSha256,
    input.expectedHash,
    'Source changed before trial',
  );
  const importStarted = performance.now();
  const { FrameAnalyzer } = await importAnalyzer(input.source);
  const importMs = performance.now() - importStarted;
  const analyzer = new FrameAnalyzer({
    maxPixels: width * height,
    visualField,
  });
  const prepareStarted = performance.now();
  analyzer.prepare(width, height);
  const prepareMs = performance.now() - prepareStarted;
  const image = new Uint8ClampedArray(width * height * 4);
  const noise = new Uint32Array(width * height);
  for (let pixel = 0; pixel < noise.length; pixel++) {
    let n = Math.imul(pixel ^ 0x6d2b79f5, 0x45d9f3b);
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    noise[pixel] = (n ^ (n >>> 16)) >>> 0;
  }
  let texture;
  if (input.workload === 'translation') {
    texture = new Uint8Array(image.length);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const pixel = y * width + x,
          at = pixel * 4;
        const value = Math.round(
          100 +
            35 * Math.sin(x / 61) +
            25 * Math.cos(y / 47) +
            20 * Math.sin((x + y) / 113) +
            (noise[pixel] & 7),
        );
        texture[at] = value;
        texture[at + 1] = value + 15;
        texture[at + 2] = value - 10;
        texture[at + 3] = 255;
      }
  }
  const times = [];
  for (let frame = 0; frame < frames; frame++) {
    const phase = Math.floor((frame * 8) / 60) % 2;
    for (let pixel = 0; pixel < noise.length; pixel++) {
      const at = pixel * 4,
        n = noise[pixel];
      if (texture) {
        const from =
          (Math.floor(pixel / width) * width +
            (((pixel % width) + frame) % width)) *
          4;
        image[at] = texture[from];
        image[at + 1] = texture[from + 1];
        image[at + 2] = texture[from + 2];
      } else if (input.workload === 'gradient') {
        const value = (pixel + frame * 3) % 256;
        image[at] = value;
        image[at + 1] = (value + 71) % 256;
        image[at + 2] = (value + 133) % 256;
      } else if (input.workload === 'pulse') {
        image[at] = image[at + 1] = image[at + 2] = phase ? 255 : 0;
      } else if (input.workload === 'sparse') {
        const x = pixel % width,
          y = Math.floor(pixel / width);
        image[at] =
          image[at + 1] =
          image[at + 2] =
            x >= 955 && x < 965 && y >= 535 && y < 545 && phase ? 255 : 0;
      } else {
        image[at] = ((n & 255) + frame * 3) & 255;
        image[at + 1] = (((n >>> 8) & 255) + frame * 3) & 255;
        image[at + 2] = (((n >>> 16) & 255) + frame * 3) & 255;
      }
      image[at + 3] = 255;
    }
    const started = performance.now();
    analyzer.pushFrame({
      rgba: image,
      width,
      height,
      timestampMs: (frame * 1000) / 60,
    });
    if (frame >= warmup) times.push(performance.now() - started);
  }
  const result = analyzer.finish(),
    sorted = [...times].sort((a, b) => a - b);
  assert.ok(result.quality.spatial);
  assert.deepEqual(
    await identity(input.source),
    before,
    'Source changed during trial',
  );
  return {
    variant: input.variant,
    workload: input.workload,
    trial: input.trial,
    sourceTreeSha256: before.treeSha256,
    width,
    height,
    frames,
    warmup,
    arrayType: 'Uint8ClampedArray',
    visualField,
    importMs,
    prepareMs,
    meanMs: times.reduce((a, b) => a + b, 0) / times.length,
    p95Ms: sorted[Math.ceil(times.length * 0.95) - 1],
    maxMs: Math.max(...times),
    framesOver16_7Ms: times.filter((value) => value > 1000 / 60).length,
    stateBytes: result.quality.spatial.stateBytes,
    resultSha256: hash(JSON.stringify(result)),
    findings: result.findings.length,
    times,
  };
}
/**
 * @param {string} baselineSource
 * @param {string} candidateSource
 */
async function differential(baselineSource, candidateSource) {
  const { FrameAnalyzer: Baseline } = await importAnalyzer(baselineSource);
  const { FrameAnalyzer: Candidate } = await importAnalyzer(candidateSource);
  const records = [];
  let findings = 0,
    liveEvents = 0,
    packedFrames = 0;
  for (const [w, h] of [
    [1, 1],
    [19, 17],
    [64, 49],
  ])
    for (const mode of [
      'uniform',
      'red',
      'dense',
      'dense-red',
      'alias-fork',
      'alpha-black',
      'source-gap',
    ])
      for (const format of [
        'uint8-aligned',
        'clamped-aligned',
        'mixed-alignment',
      ])
        for (const diagnostics of [true, false]) {
          const key = `${w}x${h}/${mode}/${format}/${diagnostics}`;
          const eventsA =
              /** @type {import("../../core/src/index.js").Finding[]} */ ([]),
            eventsB =
              /** @type {import("../../core/src/index.js").Finding[]} */ ([]);
          /** @type {import("../src/index.js").AnalysisOptions} */
          const options = {
            maxPixels: (w + 1) * h,
            diagnostics,
            visualField: {
              widthPx: 341,
              heightPx: 256,
              basis: 'W3C_CSS_REFERENCE',
              reference: 'Fixed differential field; no display measurement',
            },
          };
          const a = new Baseline({
            ...options,
            onCandidate: (finding) => eventsA.push(structuredClone(finding)),
          });
          const b = new Candidate({
            ...options,
            onCandidate: (finding) => eventsB.push(structuredClone(finding)),
          });
          let calls = 0;
          const dense = b.processDensePacked;
          assert.equal(
            typeof dense,
            'function',
            'Candidate must expose the packed path for execution evidence',
          );
          b.processDensePacked = function (words) {
            calls++;
            return dense.call(this, words);
          };
          for (let frame = 0; frame < 160; frame++) {
            const wNow = w + (mode === 'source-gap' && frame >= 110 ? 1 : 0);
            const offset =
              format === 'mixed-alignment' ? (frame % 3 === 0 ? 1 : 0) : 0;
            const buffer = new ArrayBuffer(wNow * h * 4 + offset);
            const Type =
              format === 'clamped-aligned' ||
              (format === 'mixed-alignment' && frame % 2)
                ? Uint8ClampedArray
                : Uint8Array;
            const rgba = new Type(buffer, offset, wNow * h * 4),
              phase = Math.floor(frame / 5) % 2;
            for (let pixel = 0; pixel < wNow * h; pixel++) {
              const at = pixel * 4;
              let red, green, blue;
              if (
                mode === 'uniform' ||
                (mode === 'alias-fork' && (frame < 35 || frame >= 100))
              )
                red = green = blue = phase ? 230 : 10;
              else if (mode === 'red') {
                red = phase ? 255 : 0;
                green = phase ? 0 : 255;
                blue = 0;
              } else {
                let n = Math.imul(pixel ^ 0x6d2b79f5, 0x45d9f3b);
                n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
                n = (n ^ (n >>> 16)) >>> 0;
                red = (n & 63) + (phase ? 180 : 0);
                green = ((n >>> 8) & 63) + (phase ? 180 : 0);
                blue = ((n >>> 16) & 63) + (phase ? 180 : 0);
                if (mode === 'dense-red' && pixel % 3 === 0) {
                  red = phase ? 230 + (n & 15) : 0;
                  green = phase ? 0 : 230 + ((n >>> 8) & 15);
                  blue = 0;
                }
              }
              if (
                mode === 'alpha-black' &&
                frame >= 75 &&
                frame < 80 &&
                pixel % 7 === 0
              )
                red = green = blue = 0;
              rgba[at] = red;
              rgba[at + 1] = green;
              rgba[at + 2] = blue;
              rgba[at + 3] =
                mode === 'alpha-black' &&
                frame >= 50 &&
                frame < 54 &&
                pixel % 11 === 0
                  ? 120
                  : 255;
            }
            const input = {
              rgba,
              width: wNow,
              height: h,
              timestampMs:
                (frame * 1000) / 60 +
                (mode === 'source-gap' && frame >= 80 ? 140 : 0),
              sourceWidth:
                mode === 'source-gap' && frame >= 90 ? wNow * 2 : wNow,
              sourceHeight: h,
            };
            a.pushFrame(input);
            b.pushFrame(input);
            if (mode === 'source-gap' && frame === 130) {
              a.markInterrupted('Exact comparison interruption');
              b.markInterrupted('Exact comparison interruption');
            }
          }
          const expected = a.finish(),
            actual = b.finish();
          assert.deepEqual(actual, expected, key);
          assert.deepEqual(eventsB, eventsA, `live events ${key}`);
          findings += actual.findings.length;
          liveEvents += eventsB.length;
          packedFrames += calls;
          records.push({
            key,
            packedFrames: calls,
            findings: actual.findings.length,
            liveEvents: eventsB.length,
            resultSha256: hash(JSON.stringify(actual)),
            eventsSha256: hash(JSON.stringify(eventsB)),
          });
        }
  if (new Uint8Array(new Uint32Array([1]).buffer)[0] === 1) {
    assert.ok(packedFrames > 0, 'The optimized path must actually execute');
    for (const format of [
      'uint8-aligned',
      'clamped-aligned',
      'mixed-alignment',
    ])
      assert.ok(
        records.some(
          (record) => record.key.includes(format) && record.packedFrames > 0,
        ),
      );
  }
  return {
    cases: records.length,
    findings,
    liveEvents,
    packedFrames,
    completeResultsIdentical: true,
    liveEventsIdentical: true,
    records,
  };
}
async function main() {
  if (process.argv[2] === '--child') {
    process.stdout.write(
      JSON.stringify(
        await benchmarkOne(JSON.parse(process.argv[3].toString())),
      ),
    );
    return;
  }
  /** @type {Record<string,string>} */
  const options = {};
  const accepted = new Set([
    '--source',
    '--baseline-source',
    '--expected-source-sha256',
    '--output',
    '--mode',
  ]);
  for (let at = 2; at < process.argv.length; at += 2) {
    assert.ok(
      accepted.has(process.argv[at]) && process.argv[at + 1],
      `Unknown or incomplete option: ${process.argv[at]}`,
    );
    options[process.argv[at]] = process.argv[at + 1];
  }
  assert.ok(
    options['--output'],
    '--output is required; existing evidence will not be overwritten',
  );
  const mode = options['--mode'] ?? 'throughput';
  assert.ok(
    ['throughput', 'differential'].includes(mode),
    'Mode must be throughput or differential',
  );
  const candidate = resolve(
    options['--source'] ?? join(dirname(script), '../src'),
  );
  let temporary;
  try {
    let baseline =
      options['--baseline-source'] && resolve(options['--baseline-source']);
    if (!baseline) {
      const archive = await readFile(
        new URL(
          '../validation/dense-color-0.4.0-baseline.json.gz',
          import.meta.url,
        ),
      );
      const evidence = JSON.parse(
        (
          await readFile(
            new URL(
              '../validation/dense-color-0.4.0-experiments.json',
              import.meta.url,
            ),
          )
        ).toString(),
      );
      assert.equal(
        hash(archive),
        evidence.frozenBaseline.archiveSha256,
        'Frozen baseline archive changed',
      );
      const snapshot = JSON.parse(gunzipSync(archive).toString());
      assert.deepEqual(Object.keys(snapshot.files).sort(), files);
      temporary = await mkdtemp(join(tmpdir(), 'epiless-dense-baseline-'));
      baseline = temporary;
      for (const name of files) {
        assert.equal(typeof snapshot.files[name], 'string');
        await writeFile(join(baseline, name), snapshot.files[name], {
          flag: 'wx',
        });
      }
      await writeFile(join(baseline, 'package.json'), '{"type":"module"}', {
        flag: 'wx',
      });
      assert.deepEqual(
        await identity(baseline),
        evidence.frozenBaseline.identity,
        'Frozen baseline source differs',
      );
    }
    const sources = {
      baseline: await identity(baseline),
      candidate: await identity(candidate),
    };
    if (options['--expected-source-sha256'])
      assert.equal(
        sources.candidate.treeSha256,
        options['--expected-source-sha256'],
      );
    let measured;
    if (mode === 'differential')
      measured = await differential(baseline, candidate);
    else {
      const results = [];
      for (let trial = 0; trial < 3; trial++)
        for (const workload of workloads) {
          for (const variant of trial % 2
            ? /** @type {const} */ (['candidate', 'baseline'])
            : /** @type {const} */ (['baseline', 'candidate'])) {
            const input = {
              source: variant === 'baseline' ? baseline : candidate,
              expectedHash: sources[variant].treeSha256,
              variant,
              workload,
              trial,
            };
            const child = spawnSync(
              process.execPath,
              [script, '--child', JSON.stringify(input)],
              { encoding: 'utf8', maxBuffer: 1024 * 1024 },
            );
            if (child.status !== 0)
              throw new Error(
                `Trial failed: ${variant}/${workload}/${trial}\n${child.stderr}`,
              );
            const result = JSON.parse(child.stdout.toString());
            results.push(result);
            process.stderr.write(
              `${variant}/${workload}/${trial}: ${result.meanMs.toFixed(2)} ms, p95 ${result.p95Ms.toFixed(2)} ms\n`,
            );
          }
        }
      for (const workload of workloads)
        assert.equal(
          new Set(
            results
              .filter((result) => result.workload === workload)
              .map((result) => result.resultSha256),
          ).size,
          1,
          `Complete report mismatch: ${workload}`,
        );
      measured = {
        width,
        height,
        frames,
        warmup,
        trials: 3,
        visualField,
        completeResultHashesIdentical: true,
        results,
      };
    }
    assert.deepEqual(
      await identity(baseline),
      sources.baseline,
      'Baseline changed during run',
    );
    assert.deepEqual(
      await identity(candidate),
      sources.candidate,
      'Candidate changed during run',
    );
    const report = {
      recordedAt: new Date().toISOString(),
      mode,
      node: process.version,
      cpu: cpus()[0].model,
      platform: `${process.platform}/${process.arch}`,
      osRelease: release(),
      benchmarkSourceSha256: hash(await readFile(script)),
      sources,
      scope:
        mode === 'throughput'
          ? 'Numeric pushFrame CPU only on this machine; diagnostics enabled; each workload/trial in a fresh process. Generation, prepare, import, capture, conversion, IPC and rendering excluded. No 60fps guarantee or display/hardware claim.'
          : 'Deterministic complete finish() and live callback comparison to frozen source; array types, unaligned fallback, alpha/black resets, history forks, source changes, timestamp gaps and interruption. This is regression evidence, not independent normative validation.',
      ...measured,
    };
    await writeFile(
      resolve(options['--output']),
      `${JSON.stringify(report, null, 2)}\n`,
      { flag: 'wx' },
    );
    process.stdout.write(
      `${JSON.stringify({ output: resolve(options['--output']), mode, sourceTreeSha256: sources.candidate.treeSha256 })}\n`,
    );
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}
await main();
