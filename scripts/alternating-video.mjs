// Frozen externally authored compositions; numeric decoding only, never playback.
import assert from 'node:assert/strict';

import { readFile } from 'node:fs/promises';

import { once } from 'node:events';

import { basename, resolve } from 'node:path';

import { FrameAnalyzer } from '../packages/analysis-engine/src/index.ts';

import { backendExecution } from './detection-kernel.mjs';

import {
  sourceFrame,
  verifyDecodedFrames,
  verifyFrameTimes,
} from './validate-spatial-media.mjs';

import { hash } from './alternating-corpus.mjs';
import { child, command, verifyMask } from './alternating-media.mjs';

/** Decode one pinned alternating composition without playing or modifying it.
 * @param {Awaited<ReturnType<typeof import('./alternating-corpus.mjs').verifyAlternatingCorpus>>} reference
 * @param {Awaited<ReturnType<typeof import('./alternating-corpus.mjs').verifyAlternatingCorpus>>['manifest']['videos'][number]} item
 * @param {Map<string,Awaited<ReturnType<typeof verifyMask>>>} masks
 * @param {import('./helper-types.js').VideoConfig} config
 * @param {ReturnType<typeof import('./validate-detection.mjs').parseSamples>} samples
 * @param {string} mediaDirectory
 * @returns {Promise<import('./helper-types.js').AlternatingCase>}
 */
export async function validateAlternatingVideo(
  reference,
  item,
  masks,
  config,
  samples,
  mediaDirectory,
) {
  if (!masks.has(item.dependencies.spatial))
    masks.set(
      item.dependencies.spatial,
      await verifyMask(reference, item.dependencies.spatial),
    );
  const pixels = masks.get(item.dependencies.spatial),
    background = config.bgcolor.slice(1, -1).split(',').map(Number);
  assert.ok(pixels, 'Missing verified mask');
  const mediaName = basename(item.path, '.json') + '.avi',
    mediaPath = resolve(mediaDirectory, mediaName);
  const encoder = child('ffmpeg', [
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
    '30',
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
  const times = verifyFrameTimes(probe, samples.length, 30);
  const analyzer = new FrameAnalyzer({
    maxPixels: 1920 * 1080,
    minEffectiveFps: 29,
    diagnostics: false,
    visualField: {
      widthPx: 341,
      heightPx: 256,
      basis: 'W3C_1024_768_REFERENCE',
      reference:
        'Upstream fixed 341x256 source-pixel field; not viewer calibration or CSS/display inference.',
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
      1920 * 1080 * 4,
      generatedHashes,
      (rgba, i) =>
        analyzer.pushFrame({
          rgba: new Uint8Array(rgba),
          width: 1920,
          height: 1080,
          sourceWidth: 1920,
          sourceHeight: 1080,
          timestampMs: times[i],
        }),
    );
    await decoder.done;
  } catch (error) {
    decoder.process.kill();
    await decoder.done.catch(() => undefined);
    throw error;
  }
  const result = analyzer.finish(),
    general = result.findings.filter((f) => f.type === 'GENERAL_FLASH');
  const observedCandidate = general.some(
    (f) => f.spatial?.visualField?.exceedsThreshold === true,
  );
  const jsonExpected = ['pass', 'fail'].includes(item.expectedWcagClassic)
    ? item.expectedWcagClassic === 'fail'
    : null;
  const csvExpected = item.upstreamCsvPass === 'FALSE';
  return {
    id: item.path,
    dependencies: item.dependencies,
    upstreamJsonLabel: item.expectedWcagClassic,
    jsonExpectedCandidate: jsonExpected,
    upstreamCsvPass: item.upstreamCsvPass,
    upstreamCsvDimension: item.upstreamCsvDimension,
    csvExpectedCandidate: csvExpected,
    sourceLabelConflict: jsonExpected === null || jsonExpected !== csvExpected,
    observedCandidate,
    jsonAgreement:
      jsonExpected === null ? null : jsonExpected === observedCandidate,
    csvAgreement: csvExpected === observedCandidate,
    eventAnnotationsUnscored: item.eventAnnotations,
    failureDetailsUnscored: item.failureDetails,
    frameCount: samples.length,
    frameRate: 30,
    width: 1920,
    height: 1080,
    mediaFile: mediaName,
    mediaSha256: hash(await readFile(mediaPath)),
    maskDecodedRgbaSha256: pixels.decodedRgbaSha256,
    generatedFrameSha256: generatedHashes,
    decodedFrameSha256: decodedHashes,
    decodedFrameTimestampMs: times,
    engineStatus: result.status,
    findings: result.findings,
    quality: result.quality,
    analysisBackend: backendExecution(analyzer),
  };
}
