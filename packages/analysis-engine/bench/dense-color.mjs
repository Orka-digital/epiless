import assert from 'node:assert/strict';

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import { cpus, release, tmpdir } from 'node:os';

import { dirname, join, resolve } from 'node:path';

import { spawnSync } from 'node:child_process';

import { fileURLToPath } from 'node:url';

import { gunzipSync } from 'node:zlib';

import { differential } from './dense-color-differential.mjs';
import { files, hash, identity } from './dense-color-identity.mjs';
import {
  benchmarkOne,
  frames,
  height,
  visualField,
  warmup,
  width,
  workloads,
} from './dense-color-workload.mjs';

// Numeric buffers only: never render or play these fixtures. The default oracle
// is the immutable pre-optimization 4a tree, not a second current-engine import.
// Run from the repository using Node 24:
// node packages/analysis-engine/bench/dense-color.mjs --mode differential --output artifacts/dense-color-proof.json
// node packages/analysis-engine/bench/dense-color.mjs --output artifacts/dense-color-throughput.json
// --source DIR selects another candidate tree; --baseline-source DIR explicitly
// replaces the frozen baseline. --expected-source-sha256 HASH pins a candidate.
// All output paths are exclusive: historical evidence is never overwritten.
const script = fileURLToPath(import.meta.url);

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
