import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  sourceFrame,
  verifyDecodedFrames,
  verifyFrameTimes,
} from './validate-spatial-media.mjs';

const hash = (/** @type {import("node:crypto").BinaryLike} */ bytes) =>
  createHash('sha256').update(bytes).digest('hex');
/**
 * @param {string} name
 * @param {string[]} args
 */
function command(name, args) {
  const result = spawnSync(name, args, {
    maxBuffer: 32 * 1024 * 1024,
    timeout: 30_000,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${name}: ${result.error?.message ?? result.stderr.toString().slice(-2000)}`,
    );
  return result.stdout;
}
/**
 * @param {string[]} args
 */
function child(args) {
  const process = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let error = '';
  process.stderr.on('data', (chunk) => {
    error = (error + chunk).slice(-4000);
  });
  const done = new Promise(
    /** @param {(value?: unknown) => void} resolve */ (resolve, reject) => {
      process.once('error', reject);
      process.once('close', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`ffmpeg failed (${code}): ${error}`)),
      );
    },
  );
  done.catch(() => undefined);
  // stdin write failures are reported by the awaited child exit, never an unhandled event.
  process.stdin.on('error', () => undefined);
  return { process, done };
}
export function losslessCodecVersions() {
  return {
    ffmpeg: command('ffmpeg', ['-version']).toString().split('\n')[0],
    ffprobe: command('ffprobe', ['-version']).toString().split('\n')[0],
  };
}

/** Shared source renderer, exact frame/PTS verifier and real FFV1 transport.
 * Container bytes may differ across ffmpeg builds; decoded bytes must not. */
/**
 * @param {import("./helper-types.js").RoundTripOptions} options
 */
export async function encodeDecodeReference({
  mask,
  background,
  samples,
  frameRate,
  mediaPath,
  expectedHashes,
  expectedTimes,
  onFrame,
}) {
  assert.equal(mask.length, 1920 * 1080);
  assert.equal(samples.length, expectedHashes.length);
  const encoder = child([
    '-v',
    'error',
    '-n',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-s:v',
    '1920x1080',
    '-r',
    String(frameRate),
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
    for (const [i, sample] of samples.entries()) {
      const frame = sourceFrame(mask, background, sample),
        digest = hash(frame);
      assert.equal(
        digest,
        expectedHashes[i],
        `Regenerated source frame differs: ${i}`,
      );
      generatedHashes.push(digest);
      if (!encoder.process.stdin.write(frame))
        await Promise.race([
          once(encoder.process.stdin, 'drain'),
          encoder.done.then(() => {
            throw new Error('Encoder exited before all input frames');
          }),
        ]);
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
  const times = verifyFrameTimes(probe, samples.length, frameRate);
  assert.deepEqual(
    times,
    expectedTimes,
    'Presentation timestamps changed from the frozen decoded frames',
  );
  const decoder = child([
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
      1920 * 1080 * 4,
      expectedHashes,
      (rgba, i) => onFrame(rgba, times[i]),
    );
    await decoder.done;
  } catch (error) {
    decoder.process.kill();
    await decoder.done.catch(() => undefined);
    throw error;
  }
  return {
    mediaSha256: hash(await readFile(mediaPath)),
    generatedFrameSha256: generatedHashes,
    decodedFrameSha256: decodedHashes,
    decodedFrameTimestampMs: times,
  };
}
