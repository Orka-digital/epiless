import { readFile } from 'node:fs/promises';

import { once } from 'node:events';

import { basename, dirname, relative, resolve } from 'node:path';

import { FrameAnalyzer } from '../packages/analysis-engine/src/index.ts';

import { parseSamples } from './validate-detection.mjs';

import { backendExecution } from './detection-kernel.mjs';

import { requiredFile } from './reference-files.mjs';
import { hash } from './spatial-corpus.mjs';
import {
  child,
  command,
  sourceFrame,
  verifyDecodedFrames,
  verifyFrameTimes,
} from './spatial-decoding.mjs';

/** Decode one pinned spatial/temporal composition and retain exact numeric evidence.
 * @param {Awaited<ReturnType<typeof import('./spatial-corpus.mjs').verifySpatialCorpus>>} reference
 * @param {Awaited<ReturnType<typeof import('./spatial-corpus.mjs').verifySpatialCorpus>>['manifest']['videos'][number]} item
 * @param {Map<string,ReturnType<typeof import('./spatial-decoding.mjs').pngPixels>>} maskCache
 * @param {string} mediaDirectory
 */
export async function validateSpatialVideo(
  reference,
  item,
  maskCache,
  mediaDirectory,
) {
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
  return {
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
  };
}
