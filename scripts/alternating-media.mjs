// Frozen externally authored compositions; numeric decoding only, never playback.
import assert from 'node:assert/strict';

import { spawn, spawnSync } from 'node:child_process';

import {
  decodePngAlpha,
  safeReferencePath,
} from './validate-spatial-media.mjs';

import { hash } from './alternating-corpus.mjs';
import { requiredFile } from './reference-files.mjs';

/**
 * @param {string} executable
 * @param {string[]} args
 */
export function command(executable, args) {
  const result = spawnSync(executable, args, {
    maxBuffer: 32 * 1024 * 1024,
    timeout: 30_000,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${executable}: ${result.error?.message ?? result.stderr.toString().slice(-2000)}`,
    );
  return result.stdout;
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
  done.catch(() => undefined);
  return { process, done };
}

/**
 * @param {Awaited<ReturnType<typeof import('./alternating-corpus.mjs').verifyAlternatingCorpus>>} reference
 * @param {string} path
 */
export async function verifyMask(reference, path) {
  const independent = decodePngAlpha(requiredFile(reference.files, path));
  assert.equal(independent.width, 1920);
  assert.equal(independent.height, 1080);
  const rgba = command('ffmpeg', [
    '-v',
    'error',
    '-threads',
    '1',
    '-i',
    safeReferencePath(reference.upstream, path),
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    'pipe:1',
  ]);
  assert.equal(rgba.length, 1920 * 1080 * 4);
  for (let i = 0; i < independent.mask.length; i++) {
    assert.ok(
      rgba[i * 4 + 3] === 0 || rgba[i * 4 + 3] === 255,
      'Nonbinary alpha requires separate source contract',
    );
    assert.equal(
      independent.mask[i],
      Number(rgba[i * 4 + 3] !== 0),
      'Independent PNG decoder mismatch',
    );
  }
  return { ...independent, decodedRgbaSha256: hash(rgba) };
}
