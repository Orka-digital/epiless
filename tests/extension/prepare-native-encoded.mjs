// Explicit, offline-only preparation. Never opens a browser or renders frames.
// Usage: node tests/extension/prepare-native-encoded.mjs [output-directory]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  encodedDirectory,
  encodedFrames,
  encodedSpec,
  loadNativeEncodedAssets,
  sha256,
} from './native-encoded-source.mjs';

const output = path.resolve(process.argv[2] ?? encodedDirectory);
assert.ok(process.argv.length <= 3, 'Provide at most one output directory.');
await lstat(output).then(
  () => {
    throw new Error(
      `Refusing to replace existing evidence directory: ${output}`,
    );
  },
  (error) => {
    if (error.code !== 'ENOENT') throw error;
  },
);
function command(program, args, options = {}) {
  const result = spawnSync(program, args, {
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${program} failed: ${result.error ?? result.stderr?.toString()}`,
    );
  return result.stdout;
}
const work = await mkdtemp(path.join(tmpdir(), 'flashguard-encoded-source-'));
try {
  const manifest = {
    spec: encodedSpec,
    purpose:
      'Two tiny lossless VP9 fixtures with independently checked decoded RGBA bytes and presentation timestamps. Browser colour output and capture remain separate validation boundaries.',
    verification: 'ALL_DECODED_RGBA_BYTES_AND_PTS_MATCH',
    preparedAt: new Date().toISOString(),
    ffmpegVersion: command('ffmpeg', ['-version']).toString().split('\n')[0],
    ffprobeVersion: command('ffprobe', ['-version']).toString().split('\n')[0],
    generatorSha256: sha256(await readFile(new URL(import.meta.url))),
    contractSha256: sha256(
      await readFile(new URL('./native-encoded-source.mjs', import.meta.url)),
    ),
    assets: {},
  };
  for (const [name, fixed] of [
    ['signal', false],
    ['fixed', true],
  ]) {
    const frames = encodedFrames(fixed);
    // Full-range neutral YUV has Y=R=G=B and U=V=128. Decode below must still
    // prove every resulting RGBA byte rather than assuming a colour round-trip.
    const raw = Buffer.alloc(encodedSpec.frameCount * 12, 128);
    for (const frame of frames)
      raw.fill(frame.rgba[0], frame.index * 12, frame.index * 12 + 4);
    const encodeArgs = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-f',
      'rawvideo',
      '-pixel_format',
      'yuv444p',
      '-video_size',
      '2x2',
      '-framerate',
      String(encodedSpec.fps),
      '-color_range',
      'pc',
      '-colorspace',
      'bt709',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'iec61966-2-1',
      '-i',
      'pipe:0',
      '-map',
      '0:v:0',
      '-an',
      '-c:v',
      'libvpx-vp9',
      '-profile:v',
      '1',
      '-pix_fmt',
      'yuv444p',
      '-lossless',
      '1',
      '-deadline',
      'good',
      '-cpu-used',
      '0',
      '-threads',
      '1',
      '-row-mt',
      '0',
      '-g',
      '1',
      '-auto-alt-ref',
      '0',
      '-color_range',
      'pc',
      '-colorspace',
      'bt709',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'iec61966-2-1',
      '-fps_mode',
      'passthrough',
      '-f',
      'webm',
      `${name}.webm`,
    ];
    command('ffmpeg', encodeArgs, { cwd: work, input: raw });
    const probeArgs = [
      '-v',
      'error',
      '-show_streams',
      '-show_frames',
      '-show_format',
      '-of',
      'json',
      `${name}.webm`,
    ];
    const probe = JSON.parse(command('ffprobe', probeArgs, { cwd: work }));
    assert.equal(probe.streams.length, 1);
    const stream = probe.streams[0];
    assert.equal(stream.codec_type, 'video');
    assert.equal(stream.codec_name, 'vp9');
    assert.equal(stream.width, encodedSpec.width);
    assert.equal(stream.height, encodedSpec.height);
    assert.equal(stream.pix_fmt, 'yuv444p');
    assert.equal(stream.color_range, 'pc');
    assert.equal(stream.r_frame_rate, '25/1');
    assert.equal(stream.time_base, '1/1000');
    assert.equal(probe.frames.length, frames.length);
    const decodeArgs = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-threads',
      '1',
      '-i',
      `${name}.webm`,
      '-map',
      '0:v:0',
      '-an',
      '-fps_mode',
      'passthrough',
      '-pix_fmt',
      'rgba',
      '-f',
      'rawvideo',
      'pipe:1',
    ];
    const decoded = command('ffmpeg', decodeArgs, { cwd: work });
    assert.equal(decoded.length, encodedSpec.frameCount * 16);
    for (const expected of frames) {
      const actual = probe.frames[expected.index];
      // Compare integer ticks against the proven 1/1000 time base. Do not
      // multiply decimal JSON timestamps into accidental floating-point error.
      assert.equal(actual.pts, expected.timestampMs);
      assert.equal(actual.best_effort_timestamp, expected.timestampMs);
      assert.equal(actual.duration ?? actual.pkt_duration, expected.durationMs);
      assert.equal(
        sha256(
          decoded.subarray(expected.index * 16, (expected.index + 1) * 16),
        ),
        expected.rgbaSha256,
        `Decoded RGBA mismatch at ${name} frame ${expected.index}.`,
      );
    }
    const bytes = await readFile(path.join(work, `${name}.webm`));
    manifest.assets[name] = {
      file: `${name}.webm`,
      fixed,
      bytes: bytes.length,
      sha256: sha256(bytes),
      codec: stream.codec_name,
      profile: stream.profile,
      pixelFormat: stream.pix_fmt,
      colourRange: stream.color_range,
      colourSpace: stream.color_space,
      colourPrimaries: stream.color_primaries,
      colourTransfer: stream.color_transfer,
      streams: probe.streams.length,
      sourceYuvSha256: sha256(raw),
      frames,
      decode: {
        frameCount: frames.length,
        rgbaBytes: decoded.length,
        rgbaSha256: sha256(decoded),
        maximumChannelError: 0,
        maximumTimestampErrorMs: 0,
      },
      commands: { encodeArgs, probeArgs, decodeArgs },
      probe,
    };
  }
  await writeFile(
    path.join(work, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  await loadNativeEncodedAssets(work);
  await mkdir(path.dirname(output), { recursive: true });
  // mkdir is exclusive; a competing writer or existing evidence is refused.
  // Each file also uses wx. A failed partial write never overwrites old proof.
  await mkdir(output);
  for (const name of ['signal.webm', 'fixed.webm', 'manifest.json'])
    await writeFile(
      path.join(output, name),
      await readFile(path.join(work, name)),
      { flag: 'wx' },
    );
  console.log(
    JSON.stringify(
      {
        output,
        verification: manifest.verification,
        assets: Object.fromEntries(
          Object.entries(manifest.assets).map(([name, value]) => [
            name,
            {
              sha256: value.sha256,
              bytes: value.bytes,
              frames: value.frames.length,
            },
          ]),
        ),
      },
      null,
      2,
    ),
  );
} finally {
  await rm(work, { recursive: true, force: true });
}
