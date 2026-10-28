import assert from 'node:assert/strict';

import { hash, identity, importAnalyzer } from './dense-color-identity.mjs';

export const workloads = [
  'entropy',
  'translation',
  'gradient',
  'pulse',
  'sparse',
];

export const width = 1920,
  height = 1080,
  frames = 90,
  warmup = 15;

/** @type {import("../src/spatial.js").VisualFieldCalibration} */
export const visualField = {
  widthPx: 682,
  heightPx: 512,
  basis: 'W3C_CSS_REFERENCE',
  reference:
    'Numeric profiling assumption: 341x256 CSS reference at DPR2 and standard zoom. No physical display measurement.',
};

/**
 * @param {{source:string,expectedHash:string,workload:string,variant:string,trial:number}} input
 */
export async function benchmarkOne(input) {
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
