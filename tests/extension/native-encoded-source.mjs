// Shared fixture contract, not scanner code. No media is rendered by this module.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const encodedDirectory = fileURLToPath(
  new URL('./fixtures/native-encoded/', import.meta.url),
);
export const encodedSpec = Object.freeze({
  version: 1,
  width: 2,
  height: 2,
  fps: 25,
  frameDurationMs: 40,
  frameCount: 53,
  signalDurationMs: 2080,
  durationMs: 2120,
  halfCycleMs: 80,
  baseline: 35,
  changed: 125,
  audio: false,
});
export const sha256 = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');

export function encodedFrames(fixed = false) {
  return Array.from({ length: encodedSpec.frameCount }, (_, index) => {
    const timestampMs = index * encodedSpec.frameDurationMs;
    const grey =
      !fixed &&
      timestampMs < encodedSpec.signalDurationMs &&
      Math.floor(timestampMs / encodedSpec.halfCycleMs) % 2 === 1
        ? encodedSpec.changed
        : encodedSpec.baseline;
    const rgba = Buffer.alloc(encodedSpec.width * encodedSpec.height * 4);
    for (let offset = 0; offset < rgba.length; offset += 4) {
      rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = grey;
      rgba[offset + 3] = 255;
    }
    return {
      index,
      timestampMs,
      durationMs: encodedSpec.frameDurationMs,
      rgba: [grey, grey, grey, 255],
      rgbaSha256: sha256(rgba),
    };
  });
}

// Loading performs hash/contract checks only. ffmpeg verification is a separate
// explicit preparation step, completed before starting native capture.
export async function loadNativeEncodedAssets(directory = encodedDirectory) {
  const manifestBytes = await readFile(path.join(directory, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  assert.deepEqual(manifest.spec, encodedSpec);
  assert.equal(manifest.verification, 'ALL_DECODED_RGBA_BYTES_AND_PTS_MATCH');
  const assets = {};
  for (const [name, fixed] of [
    ['signal', false],
    ['fixed', true],
  ]) {
    const record = manifest.assets[name];
    assert.equal(record.file, `${name}.webm`);
    assert.equal(record.fixed, fixed);
    assert.equal(record.codec, 'vp9');
    assert.equal(record.pixelFormat, 'yuv444p');
    assert.equal(record.colourRange, 'pc');
    assert.equal(record.streams, 1, 'Fixture must contain no audio stream.');
    assert.deepEqual(record.frames, encodedFrames(fixed));
    assert.equal(record.decode.frameCount, encodedSpec.frameCount);
    assert.equal(record.decode.rgbaBytes, encodedSpec.frameCount * 16);
    assert.equal(record.decode.maximumChannelError, 0);
    assert.equal(record.decode.maximumTimestampErrorMs, 0);
    const expectedRgba = Buffer.from(
      record.frames.flatMap((frame) =>
        Array.from({ length: 4 }, () => frame.rgba).flat(),
      ),
    );
    assert.equal(record.decode.rgbaSha256, sha256(expectedRgba));
    const bytes = await readFile(path.join(directory, record.file));
    assert.equal(bytes.length, record.bytes);
    assert.equal(sha256(bytes), record.sha256);
    assets[name] = { bytes, record };
  }
  return { manifest, manifestSha256: sha256(manifestBytes), assets };
}

export function encodedPageSource(assets, fixed = false) {
  const record = assets.assets[fixed ? 'fixed' : 'signal'].record;
  return {
    ...encodedSpec,
    fixed,
    url: `/__native-encoded/${record.file}`,
    mimeType: 'video/webm; codecs="vp9"',
    codec: record.codec,
    pixelFormat: record.pixelFormat,
    colourRange: record.colourRange,
    sourceSha256: record.sha256,
    sourceBytes: record.bytes,
    manifestSha256: assets.manifestSha256,
    decodedRgbaSha256: record.decode.rgbaSha256,
    frames: record.frames,
  };
}

export function serveEncodedAsset(request, response, bytes) {
  response.setHeader('Content-Type', 'video/webm');
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Cache-Control', 'no-store');
  const range = request.headers.range;
  if (!range) {
    response.setHeader('Content-Length', bytes.length);
    response.end(request.method === 'HEAD' ? undefined : bytes);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  let start, end;
  if (match && (match[1] || match[2])) {
    start = match[1]
      ? Number(match[1])
      : Math.max(0, bytes.length - Number(match[2]));
    end = match[1]
      ? match[2]
        ? Math.min(bytes.length - 1, Number(match[2]))
        : bytes.length - 1
      : bytes.length - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start > end ||
    start >= bytes.length
  ) {
    response.writeHead(416, { 'Content-Range': `bytes */${bytes.length}` });
    response.end();
    return;
  }
  response.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
    'Content-Length': end - start + 1,
  });
  response.end(
    request.method === 'HEAD' ? undefined : bytes.subarray(start, end + 1),
  );
}
