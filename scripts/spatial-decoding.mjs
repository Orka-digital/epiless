import { spawn, spawnSync } from 'node:child_process';

import { inflateSync } from 'node:zlib';

import { hash } from './spatial-corpus.mjs';

/**
 * @param {string} executable
 * @param {string[]} args
 */
export function command(executable, args, maxBuffer = 32 * 1024 * 1024) {
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
export function pngPixels(path, originalBytes) {
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
 * @param {string} executable
 * @param {string[]} args
 */
export function child(executable, args) {
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
