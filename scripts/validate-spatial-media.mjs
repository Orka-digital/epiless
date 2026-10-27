import { createHash } from 'node:crypto';
import { readFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { inflateSync } from 'node:zlib';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  FrameAnalyzer,
  ENGINE_VERSION,
  combinedMaskFieldAnalysis,
} from '../packages/analysis-engine/src/index.ts';
import { parseSamples, summarizeCases } from './validate-detection.mjs';
import {
  backendExecution,
  detectionKernelIdentity,
} from './detection-kernel.mjs';

const defaultRoot = fileURLToPath(
  new URL('../tests/reference/trace-spatial/', import.meta.url),
);
const repository = 'https://github.com/traceRERC/pse-test-media';
const commit = 'ef78542aad496827f25064f57aaf13d6a741ba75';
import { requiredFile } from './reference-files.mjs';

const hash = (
  /** @type {import("node:crypto").BinaryLike} */ bytes,
  algorithm = 'sha256',
) => createHash(algorithm).update(bytes).digest('hex');

/**
 * @param {string} root
 * @param {string} path
 */
export function safeReferencePath(root, path) {
  if (typeof path !== 'string' || !path)
    throw new Error('Invalid reference path');
  const file = resolve(root, path),
    rel = relative(root, file);
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw new Error('Reference path escapes corpus');
  return file;
}

/** Labels come from pinned upstream JSON and CSV separately, including source disagreements. */
export async function verifySpatialCorpus(root = defaultRoot) {
  const manifestBytes = await readFile(resolve(root, 'manifest.json'));
  /** @type {import("./helper-types.js").SpatialManifest} */
  const manifest = JSON.parse(manifestBytes.toString());
  if (
    manifest.schemaVersion !== 1 ||
    manifest.repository !== repository ||
    manifest.commit !== commit ||
    !Array.isArray(manifest.files) ||
    manifest.masks?.length !== 24 ||
    manifest.videos?.length !== 36
  )
    throw new Error('Invalid spatial manifest');
  const upstream = resolve(root, 'upstream'),
    files = /** @type {Map<string,Buffer>} */ (new Map());
  for (const item of manifest.files) {
    const path = safeReferencePath(upstream, item.path);
    if (
      files.has(item.path) ||
      item.sourceUrl !== `${repository}/blob/${commit}/${item.path}`
    )
      throw new Error('Duplicate reference or invalid provenance');
    const bytes = await readFile(path);
    if (
      hash(bytes) !== item.sha256 ||
      hash(
        Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]),
        'sha1',
      ) !== item.gitBlobSha1
    )
      throw new Error(`Reference hash mismatch: ${item.path}`);
    files.set(item.path, bytes);
  }
  const masks = new Set(),
    videos = new Set();
  for (const item of manifest.masks) {
    if (
      !/^area_patterns\/25pct_341x256\/[af]\d{3}_on_341x256_fhd\.png$/.test(
        item.path,
      ) ||
      item.expectedAboveThreshold !== basename(item.path).startsWith('f') ||
      masks.has(item.path) ||
      !files.has(item.path)
    )
      throw new Error('Spatial mask label, identity or file changed');
    masks.add(item.path);
  }
  for (const item of manifest.videos) {
    if (
      !/^video_creation\/wcagc_30fps_area0[123]\/[af]\d{3}fr?\d{3}\.json$/.test(
        item.path,
      ) ||
      videos.has(item.path) ||
      !files.has(item.path)
    )
      throw new Error('Invalid or duplicate video reference');
    videos.add(item.path);
    /** @type {import("./helper-types.js").VideoConfig} */
    const config = JSON.parse(requiredFile(files, item.path).toString());
    if (item.expectedWcagClassic !== config.expected_result?.wcag2_2)
      throw new Error('Manifest label differs from original configuration');
    if (
      config.framerate !== 30 ||
      config.colormodel !== 'sRGBA' ||
      config.pattern?.length !== 1 ||
      !/^\(\d+,\d+,\d+,255\)$/.test(config.bgcolor)
    )
      throw new Error('Unsupported upstream generation configuration');
    const parent = dirname(item.path),
      pattern = config.pattern[0];
    for (const dependency of [pattern.spatial, pattern.temporal_color]) {
      const resolved = safeReferencePath(
        upstream,
        resolve(upstream, parent, dependency),
      );
      if (!files.has(relative(upstream, resolved)))
        throw new Error(`Unpinned dependency: ${dependency}`);
    }
    const labelsPath = `${parent}/${basename(parent)}.csv`;
    if (!files.has(labelsPath))
      throw new Error('Missing independent CSV label source');
    const rows = requiredFile(files, labelsPath)
      .toString('utf8')
      .trim()
      .split(/\r?\n/);
    if (rows.shift() !== 'filename,pass,dimension')
      throw new Error('Unexpected spatial label header');
    const labels = rows.map((row) => row.split(','));
    const matches = labels.filter(
      (row) => row[0] === basename(item.path, '.json'),
    );
    if (
      matches.length !== 1 ||
      !['TRUE', 'FALSE'].includes(matches[0][1]) ||
      !['area', 'FAIL'].includes(matches[0][2])
    )
      throw new Error('Invalid original CSV video label');
    item.csvExpected = matches[0][1] === 'FALSE';
    item.csvLabelPath = labelsPath;
  }
  return { manifest, files, upstream, manifestSha256: hash(manifestBytes) };
}

/**
 * @param {string} executable
 * @param {string[]} args
 */
function command(executable, args, maxBuffer = 32 * 1024 * 1024) {
  const result = spawnSync(executable, args, {
    encoding: null,
    maxBuffer,
    timeout: 30_000,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${executable} failed: ${result.error?.message ?? result.stderr?.toString().slice(0, 2000)}`,
    );
  return result.stdout;
}
/** Independent PNG alpha reconstruction, separate from ffmpeg and engine arithmetic. */
/**
 * @param {Buffer} bytes
 */
export function decodePngAlpha(bytes) {
  if (
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error('Invalid PNG signature');
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (
    width < 1 ||
    height < 1 ||
    width * height > 1920 * 1080 ||
    bytes[24] !== 8 ||
    bytes[25] !== 6 ||
    bytes[26] !== 0 ||
    bytes[27] !== 0 ||
    bytes[28] !== 0
  )
    throw new Error('Expected bounded noninterlaced 8-bit RGBA PNG');
  const compressed = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (offset + length + 12 > bytes.length)
      throw new Error('Truncated PNG chunk');
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT')
      compressed.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const stride = width * 4,
    raw = inflateSync(Buffer.concat(compressed), {
      maxOutputLength: (stride + 1) * height,
    });
  if (raw.length !== (stride + 1) * height)
    throw new Error('Truncated PNG pixels');
  const mask = new Uint8Array(width * height);
  let previous = new Uint8Array(width);
  for (let y = 0; y < height; y++) {
    const mode = raw[y * (stride + 1)],
      alpha = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      const a = x ? alpha[x - 1] : 0,
        b = previous[x],
        c = x ? previous[x - 1] : 0;
      let predictor;
      if (mode === 0) predictor = 0;
      else if (mode === 1) predictor = a;
      else if (mode === 2) predictor = b;
      else if (mode === 3) predictor = Math.floor((a + b) / 2);
      else if (mode === 4) {
        const p = a + b - c,
          pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else throw new Error('Invalid PNG filter');
      alpha[x] = (raw[y * (stride + 1) + x * 4 + 4] + predictor) & 255;
      mask[y * width + x] = Number(alpha[x] !== 0);
    }
    previous = alpha;
  }
  return { width, height, mask };
}

/**
 * @param {string} path
 * @param {Buffer} originalBytes
 */
function pngPixels(path, originalBytes) {
  const meta = JSON.parse(
    command('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'json',
      path,
    ]).toString(),
  );
  const { width, height } = meta.streams[0] ?? {};
  if (width !== 1920 || height !== 1080)
    throw new Error('Unexpected upstream mask dimensions');
  const rgba = command('ffmpeg', [
    '-v',
    'error',
    '-threads',
    '1',
    '-i',
    path,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    'pipe:1',
  ]);
  if (rgba.length !== width * height * 4)
    throw new Error('Truncated PNG decode');
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = Number(rgba[i * 4 + 3] !== 0);
  const independent = decodePngAlpha(originalBytes);
  if (
    independent.width !== width ||
    independent.height !== height ||
    !Buffer.from(independent.mask).equals(Buffer.from(mask))
  )
    throw new Error(
      'Independent PNG alpha reconstruction differs from decoder',
    );
  return { width, height, mask, decodedRgbaSha256: hash(rgba) };
}

/** Original generator recolours nontransparent mask pixels over an opaque background. */
/**
 * @param {Uint8Array} mask
 * @param {Uint8Array | number[]} background
 * @param {Uint8Array | number[]} rgba
 */
export function sourceFrame(mask, background, rgba) {
  if (
    background.length !== 4 ||
    rgba.length !== 4 ||
    [...background, ...rgba].some(
      (v) => !Number.isInteger(v) || v < 0 || v > 255,
    ) ||
    background[3] !== 255 ||
    rgba[3] !== 255
  )
    throw new Error('Only verified opaque upstream samples are supported');
  const frame = Buffer.allocUnsafe(mask.length * 4);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 0 && mask[i] !== 1)
      throw new Error('Nonbinary source mask');
    const color = mask[i] ? rgba : background;
    frame[i * 4] = color[0];
    frame[i * 4 + 1] = color[1];
    frame[i * 4 + 2] = color[2];
    frame[i * 4 + 3] = 255;
  }
  return frame;
}

/**
 * @param {string[]} args
 * @param {string} executable
 */
function child(executable, args) {
  const process = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let error = '';
  process.stderr.on('data', (chunk) => {
    error = (error + chunk.toString()).slice(-4000);
  });
  const done = new Promise(
    /** @param {(value?: unknown) => void} resolve */ (resolve, reject) => {
      process.once('error', reject);
      process.once('close', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`${executable} failed (${code}): ${error}`)),
      );
    },
  );
  // Attach immediately so a write failure never leaves an unhandled rejection.
  done.catch(() => undefined);
  return { process, done };
}

/** Streaming framing validates every decoded byte and frame count before trusting analysis. */
/**
 * @param {AsyncIterable<Buffer> | Iterable<Buffer>} chunks
 * @param {number} frameSize
 * @param {string[]} expectedHashes
 * @param {(frame: Buffer, index: number) => void | Promise<void>} onFrame
 */
export async function verifyDecodedFrames(
  chunks,
  frameSize,
  expectedHashes,
  onFrame,
) {
  if (
    !Number.isInteger(frameSize) ||
    frameSize < 4 ||
    frameSize > 1920 * 1080 * 4 ||
    !expectedHashes.length
  )
    throw new Error('Invalid decoded-frame contract');
  let pending = Buffer.alloc(frameSize),
    used = 0,
    index = 0;
  const hashes = [];
  for await (const chunk of chunks) {
    let offset = 0;
    while (offset < chunk.length) {
      const count = Math.min(frameSize - used, chunk.length - offset);
      chunk.copy(pending, used, offset, offset + count);
      used += count;
      offset += count;
      if (used === frameSize) {
        const digest = hash(pending);
        if (index >= expectedHashes.length || digest !== expectedHashes[index])
          throw new Error(`Lossless decoded frame hash mismatch: ${index}`);
        hashes.push(digest);
        await onFrame(pending, index++);
        pending = Buffer.alloc(frameSize);
        used = 0;
      }
    }
  }
  if (used || index !== expectedHashes.length)
    throw new Error('Truncated decoded media or wrong frame count');
  return hashes;
}

/**
 * @param {import("./helper-types.js").VideoProbe} probe
 * @param {number} frameCount
 * @param {number} frameRate
 */
export function verifyFrameTimes(probe, frameCount, frameRate) {
  const stream = probe.streams?.[0];
  if (
    !stream ||
    stream.codec_name !== 'ffv1' ||
    stream.width !== 1920 ||
    stream.height !== 1080 ||
    stream.r_frame_rate !== `${frameRate}/1` ||
    probe.frames?.length !== frameCount
  )
    throw new Error(
      'Unexpected lossless video geometry, codec, rate or frame count',
    );
  return probe.frames.map((frame, index) => {
    const time = Number(frame.best_effort_timestamp_time);
    if (!Number.isFinite(time) || Math.abs(time - index / frameRate) > 0.00001)
      throw new Error(`Decoded timestamp mismatch: ${index}`);
    return time * 1000;
  });
}

async function engineHashes() {
  const root = fileURLToPath(
    new URL('../packages/analysis-engine/src/', import.meta.url),
  );
  const entries = [];
  for (const file of (await readdir(root))
    .filter((name) => name.endsWith('.ts'))
    .sort())
    entries.push({
      path: file,
      sha256: hash(await readFile(resolve(root, file))),
    });
  return { files: entries, sha256: hash(JSON.stringify(entries)) };
}

/** Keep each reviewed disagreement visible; an improvement cannot offset a new case-level regression. */
/**
 * @param {import("./helper-types.js").SpatialReport} report
 * @param {import("./helper-types.js").SpatialReport} baseline
 */
export function compareSpatialBaseline(report, baseline) {
  for (const key of /** @type {const} */ ([
    'repository',
    'commit',
    'manifestSha256',
  ]))
    if (
      !report.reference?.[key] ||
      report.reference[key] !== baseline.reference?.[key]
    )
      throw new Error(
        'Spatial baseline reference changed; explicit baseline review required',
      );
  if (
    ![
      'ORIGINAL_SPATIAL_MASKS',
      'LOSSLESS_DECODED_SPATIAL_TEMPORAL_MEDIA',
    ].includes(report.scope) ||
    baseline.scope !== 'LOSSLESS_DECODED_SPATIAL_TEMPORAL_MEDIA'
  )
    throw new Error('Invalid spatial baseline scope');
  const knownMismatches = /** @type {string[]} */ ([]),
    improvements = /** @type {string[]} */ ([]),
    newMismatches = /** @type {string[]} */ ([]);
  const compare = (
    /** @type {string} */ id,
    /** @type {boolean} */ expected,
    /** @type {boolean} */ observed,
    /** @type {boolean} */ previous,
  ) => {
    if (
      typeof expected !== 'boolean' ||
      typeof observed !== 'boolean' ||
      typeof previous !== 'boolean'
    )
      throw new Error('Invalid baseline outcome');
    const wasMismatch = expected !== previous,
      isMismatch = expected !== observed;
    if (wasMismatch && isMismatch) knownMismatches.push(id);
    else if (isMismatch) newMismatches.push(id);
    else if (wasMismatch) improvements.push(id);
  };
  /** @template {{id:string}} T
   * @param {T[]} current
   * @param {T[]} recorded
   * @returns {[T,T][]}
   */
  const pairs = (current, recorded) => {
    if (
      !Array.isArray(current) ||
      !Array.isArray(recorded) ||
      current.length !== recorded.length
    )
      throw new Error('Baseline case set changed');
    const before = new Map(recorded.map((v) => [v.id, v]));
    if (
      before.size !== recorded.length ||
      new Set(current.map((v) => v.id)).size !== current.length
    )
      throw new Error('Duplicate baseline identity');
    return current.map((item) => {
      const old = before.get(item.id);
      if (!old) throw new Error('Baseline case identity changed');
      return [item, old];
    });
  };
  for (const [item, old] of pairs(report.masks, baseline.masks)) {
    if (
      item.expectedCandidate !== old.expectedCandidate ||
      item.decodedRgbaSha256 !== old.decodedRgbaSha256
    )
      throw new Error('Baseline mask label or decoded bytes changed');
    compare(
      `mask:${item.id}`,
      item.expectedCandidate,
      item.observedCandidate,
      old.observedCandidate,
    );
  }
  if (report.scope === 'LOSSLESS_DECODED_SPATIAL_TEMPORAL_MEDIA')
    for (const [item, old] of pairs(report.videos, baseline.videos)) {
      for (const field of /** @type {const} */ ([
        'kind',
        'upstreamJsonLabel',
        'jsonExpectedCandidate',
        'csvExpectedCandidate',
        'frameCount',
        'frameRate',
        'width',
        'height',
      ]))
        if (item[field] !== old[field])
          throw new Error('Baseline video label or sampling contract changed');
      for (const field of /** @type {const} */ ([
        'generatedFrameSha256',
        'decodedFrameSha256',
        'decodedFrameTimestampMs',
      ]))
        if (JSON.stringify(item[field]) !== JSON.stringify(old[field]))
          throw new Error('Baseline decoded media evidence changed');
      if (item.jsonExpectedCandidate !== null)
        compare(
          `video-json:${item.id}`,
          item.jsonExpectedCandidate,
          item.observedCandidate,
          old.observedCandidate,
        );
      compare(
        `video-csv:${item.id}`,
        item.csvExpectedCandidate,
        item.observedCandidate,
        old.observedCandidate,
      );
    }
  return {
    status: newMismatches.length ? 'REGRESSION' : 'NO_NEW_MISMATCHES',
    knownMismatches,
    improvements,
    newMismatches,
    baselineEngineSourceSha256: baseline.engineSource?.sha256,
  };
}

export async function validateSpatialMedia({
  root = defaultRoot,
  mediaDirectory = resolve('artifacts/spatial-media'),
  masksOnly = false,
  progress = /** @type {(message: string) => void} */ (() => undefined),
} = {}) {
  const reference = await verifySpatialCorpus(root);
  const before = await engineHashes();
  const kernel = await detectionKernelIdentity();
  const ffmpegVersion = command('ffmpeg', ['-version'])
    .toString()
    .split('\n')[0];
  const maskCache = /** @type {Map<string,ReturnType<typeof pngPixels>>} */ (
      new Map()
    ),
    masks = [];
  for (const item of reference.manifest.masks) {
    const pixels = pngPixels(
      safeReferencePath(reference.upstream, item.path),
      requiredFile(reference.files, item.path),
    );
    maskCache.set(item.path, pixels);
    const area = combinedMaskFieldAnalysis(
      pixels.mask,
      pixels.width,
      pixels.height,
      341,
      256,
    );
    masks.push({
      id: item.path,
      expectedCandidate: item.expectedAboveThreshold,
      observedCandidate: area.exceedsThreshold,
      ...area,
      decodedRgbaSha256: pixels.decodedRgbaSha256,
    });
  }
  const videos = [];
  if (!masksOnly) await mkdir(mediaDirectory, { recursive: true });
  for (const [index, item] of (masksOnly
    ? []
    : reference.manifest.videos
  ).entries()) {
    progress(
      `Lossless media ${index + 1}/${reference.manifest.videos.length}: ${item.path}`,
    );
    if (typeof item.csvExpected !== 'boolean' || !item.csvLabelPath)
      throw new Error('Missing verified CSV label');
    /** @type {import("./helper-types.js").VideoConfig} */
    const config = JSON.parse(
        requiredFile(reference.files, item.path).toString(),
      ),
      parent = dirname(item.path);
    const dependency = (/** @type {string} */ path) =>
      relative(reference.upstream, resolve(reference.upstream, parent, path));
    const pixels = maskCache.get(dependency(config.pattern[0].spatial));
    if (!pixels) throw new Error('Video references unknown spatial mask');
    const samples = parseSamples(
      requiredFile(
        reference.files,
        dependency(config.pattern[0].temporal_color),
      ).toString(),
      { allowZeroBased: true },
    );
    const background = config.bgcolor.slice(1, -1).split(',').map(Number);
    const mediaName = `${basename(parent)}-${basename(item.path, '.json')}.avi`,
      mediaPath = resolve(mediaDirectory, mediaName);
    const encoder = child('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      '-s:v',
      `${pixels.width}x${pixels.height}`,
      '-r',
      String(config.framerate),
      '-i',
      'pipe:0',
      '-an',
      '-c:v',
      'ffv1',
      '-level',
      '3',
      '-pix_fmt',
      'bgra',
      '-threads',
      '1',
      mediaPath,
    ]);
    encoder.process.stdout.resume();
    const generatedHashes = [];
    try {
      for (const sample of samples) {
        const frame = sourceFrame(pixels.mask, background, sample);
        generatedHashes.push(hash(frame));
        if (!encoder.process.stdin.write(frame))
          await once(encoder.process.stdin, 'drain');
      }
      encoder.process.stdin.end();
      await encoder.done;
    } catch (error) {
      encoder.process.kill();
      await encoder.done.catch(() => undefined);
      throw error;
    }
    const probe = JSON.parse(
      command('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name,width,height,r_frame_rate:frame=best_effort_timestamp_time',
        '-of',
        'json',
        mediaPath,
      ]).toString(),
    );
    const times = verifyFrameTimes(probe, samples.length, config.framerate);
    const analyzer = new FrameAnalyzer({
      maxPixels: 1920 * 1080,
      minEffectiveFps: 29,
      diagnostics: false,
      visualField: {
        widthPx: 341,
        heightPx: 256,
        basis: 'W3C_1024_768_REFERENCE',
        reference:
          'Upstream WCAG Classic test geometry: any 341x256 source-pixel field; not actual viewer calibration.',
      },
    });
    const decoder = child('ffmpeg', [
      '-v',
      'error',
      '-threads',
      '1',
      '-i',
      mediaPath,
      '-an',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      '-fps_mode',
      'passthrough',
      'pipe:1',
    ]);
    decoder.process.stdin.end();
    let decodedHashes;
    try {
      decodedHashes = await verifyDecodedFrames(
        decoder.process.stdout,
        pixels.width * pixels.height * 4,
        generatedHashes,
        (rgba, i) => {
          analyzer.pushFrame({
            rgba: new Uint8Array(rgba),
            width: pixels.width,
            height: pixels.height,
            sourceWidth: pixels.width,
            sourceHeight: pixels.height,
            timestampMs: times[i],
          });
        },
      );
      await decoder.done;
    } catch (error) {
      decoder.process.kill();
      await decoder.done.catch(() => undefined);
      throw error;
    }
    const result = analyzer.finish();
    const kind = parent.endsWith('area03') ? 'RED_FLASH' : 'GENERAL_FLASH';
    const found = result.findings.filter((finding) => finding.type === kind);
    const observedCandidate = found.some(
      (finding) => finding.spatial?.visualField?.exceedsThreshold === true,
    );
    const jsonExpected = ['pass', 'fail'].includes(item.expectedWcagClassic)
      ? item.expectedWcagClassic === 'fail'
      : null;
    videos.push({
      id: item.path,
      kind,
      upstreamJsonLabel: item.expectedWcagClassic,
      jsonExpectedCandidate: jsonExpected,
      upstreamCsvLabelPath: item.csvLabelPath,
      csvExpectedCandidate: item.csvExpected,
      sourceLabelConflict:
        jsonExpected === null || jsonExpected !== item.csvExpected,
      observedCandidate,
      jsonAgreement:
        jsonExpected === null ? null : jsonExpected === observedCandidate,
      csvAgreement: item.csvExpected === observedCandidate,
      frameCount: samples.length,
      frameRate: config.framerate,
      width: pixels.width,
      height: pixels.height,
      mediaFile: mediaName,
      mediaSha256: hash(await readFile(mediaPath)),
      generatedFrameSha256: generatedHashes,
      decodedFrameSha256: decodedHashes,
      decodedFrameTimestampMs: times,
      temporalCandidateCount: found.length,
      maximumFieldPixels: Math.max(
        0,
        ...found.map(
          (finding) => finding.spatial?.visualField?.maximumPixels ?? 0,
        ),
      ),
      maximumFieldRatio: Math.max(
        0,
        ...found.map(
          (finding) => finding.spatial?.visualField?.maximumRatio ?? 0,
        ),
      ),
      quality: result.quality,
      analysisBackend: backendExecution(analyzer),
    });
  }
  const after = await engineHashes();
  if (
    JSON.stringify(kernel) !== JSON.stringify(await detectionKernelIdentity())
  )
    throw new Error(
      'Kernel source or packaged bytes changed during validation',
    );
  if (before.sha256 !== after.sha256)
    throw new Error(
      'Engine source changed during validation; rerun a consistent build',
    );
  return {
    schemaVersion: 1,
    kernel,
    scope: masksOnly
      ? 'ORIGINAL_SPATIAL_MASKS'
      : 'LOSSLESS_DECODED_SPATIAL_TEMPORAL_MEDIA',
    generatedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    engineSource: before,
    reference: { repository, commit, manifestSha256: reference.manifestSha256 },
    decoder: {
      ffmpegVersion,
      codec: 'FFV1 level 3',
      encodedPixelFormat: 'bgra',
      decodedPixelFormat: 'rgba',
      container: 'AVI',
    },
    sourceRendering:
      'Original single-pattern opaque sRGBA samples recolour every nontransparent mask pixel over configured opaque background, matching pinned generate_frames.py. No added delivery padding, scaling, interpolation or colour conversion.',
    scopeLimitations: [
      'No browser capture or display pipeline exercised.',
      '341x256 field is the upstream fixed test geometry, not a measured physical viewing field.',
      'JSON and CSV source labels are preserved separately, including conflicts and malformed labels.',
      'Never play these generated media as part of validation. Only decoded bytes are analyzed.',
      'After first evaluation, these cases are development regressions rather than held-out validation.',
    ],
    maskSummary: summarizeCases(masks),
    masks,
    videoJsonSummary: summarizeCases(
      videos
        .filter((v) => v.jsonExpectedCandidate !== null)
        .map((v) => ({
          expectedCandidate: v.jsonExpectedCandidate,
          observedCandidate: v.observedCandidate,
        })),
    ),
    videoCsvSummary: summarizeCases(
      videos.map((v) => ({
        expectedCandidate: v.csvExpectedCandidate,
        observedCandidate: v.observedCandidate,
      })),
    ),
    sourceLabelConflicts: videos
      .filter((v) => v.sourceLabelConflict)
      .map((v) => v.id),
    videos,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2),
      outputIndex = args.indexOf('--output');
    /** @type {Awaited<ReturnType<typeof validateSpatialMedia>> & {baseline?:ReturnType<typeof compareSpatialBaseline>}} */
    const report = await validateSpatialMedia({
      masksOnly: args.includes('--masks-only'),
      progress: (value) => process.stderr.write(`${value}\n`),
    });
    if (args.includes('--check-baseline')) {
      report.baseline = compareSpatialBaseline(
        report,
        JSON.parse(
          (
            await readFile(
              resolve(defaultRoot, 'first-encounter-0.4.0.json'),
              'utf8',
            )
          ).toString(),
        ),
      );
      if (report.baseline.status === 'REGRESSION') process.exitCode = 2;
    }
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (outputIndex >= 0) {
      const output = args[outputIndex + 1];
      if (!output) throw new Error('Missing --output path');
      await writeFile(resolve(output), json, { flag: 'wx' });
      process.stdout.write(
        `${JSON.stringify({ output, maskSummary: report.maskSummary, videoJsonSummary: report.videoJsonSummary, videoCsvSummary: report.videoCsvSummary, sourceLabelConflicts: report.sourceLabelConflicts }, null, 2)}\n`,
      );
    } else process.stdout.write(json);
    if (
      args.includes('--require-match') &&
      (report.maskSummary.mismatches ||
        report.videoJsonSummary.mismatches ||
        report.videoCsvSummary.mismatches)
    )
      process.exitCode = 2;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : error}\n`,
    );
    process.exitCode = 1;
  }
}
