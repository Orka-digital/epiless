import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

import {
  phaseComparisonReasons,
  phasePlanFromEvidence,
  phasePlanKey,
  validPhaseEvidence,
  validPhasePlan,
} from '../../apps/chrome-extension/src/animation-phase';

import type {
  Observation,
  ScanJob,
} from '../../apps/chrome-extension/src/model';

import { prepareExportJobs } from '../../apps/chrome-extension/src/export';

import { buildReport } from '../../apps/chrome-extension/src/report';
import {
  animation,
  clock,
  evidence,
  finding,
  observation,
} from './animation-phase.fixture';
describe('bounded document and animation phase replay', () => {
  it('requires actual candidate boundary clocks and does not expand capture coverage', () => {
    const o = observation(evidence());
    const missing = finding();
    delete missing.sourceTimeline!.frameClock;
    expect(phaseComparisonReasons(o, o, missing)).toEqual([
      'CANDIDATE_PHASE_BOUNDARY_UNPROVEN',
    ]);
    for (const boundary of [
      'windowStartEpochMs',
      'windowEndEpochMs',
    ] as const) {
      const f = finding();
      f.sourceTimeline![boundary] =
        boundary === 'windowStartEpochMs' ? 101000 : 103000;
      expect(phaseComparisonReasons(o, o, f)).toEqual([
        'CANDIDATE_OUTSIDE_PHASE_OBSERVATION',
      ]);
    }
  });

  it('rejects missing legacy evidence, overflow, reversed clock and unsupported discovery', () => {
    expect(
      phaseComparisonReasons({} as Observation, observation(evidence())),
    ).toEqual(['PHASE_EVIDENCE_UNAVAILABLE']);
    const e = evidence();
    e.complete = false;
    e.reasons = ['ANIMATION_DISCOVERY_INCOMPLETE'];
    expect(phasePlanFromEvidence(e).status).toBe('UNSUPPORTED');
    expect(
      phaseComparisonReasons(observation(e), observation(evidence()))[0],
    ).toBe('PHASE_EVIDENCE_INCOMPLETE');
    e.end = clock(999);
    expect(validPhaseEvidence(e)).toBe(false);
    e.end = clock(3000);
    e.animations = Array.from({ length: 33 }, () => animation());
    expect(validPhaseEvidence(e)).toBe(false);
  });

  it('rejects animation records outside the actually observed interval', () => {
    const e = evidence();
    e.animations[0].first.clock = clock(999);
    expect(validPhaseEvidence(e)).toBe(false);
    e.animations[0].first.clock = clock(1000);
    e.animations[0].last.clock = clock(3001);
    expect(validPhaseEvidence(e)).toBe(false);
  });

  it('binds phase instructions into recipe identity and rejects corrupt plans', () => {
    const p = phasePlanFromEvidence(evidence());
    expect(validPhasePlan(p)).toBe(true);
    const key = phasePlanKey(p);
    p.startDocumentMs++;
    expect(phasePlanKey(p)).not.toEqual(key);
    p.endDocumentMs = 0;
    expect(validPhasePlan(p)).toBe(false);
  });

  it('strips local document clocks and animation plans from public and pseudonymized exports', () => {
    const job = JSON.parse(
      readFileSync(
        new URL(
          './evidence/scanner-v04-native-current-encoded-local-job.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as ScanJob;
    const o = job.tasks.flatMap((t) => t.observations).find((o) => o.replay)!;
    o.phaseEvidence = evidence();
    o.replay!.phasePlan = phasePlanFromEvidence(o.phaseEvidence);
    const local = prepareExportJobs([job], false);
    expect(
      local[0].tasks
        .flatMap((t) => t.observations)
        .some((o) => o.phaseEvidence),
    ).toBe(true);
    const masked = JSON.stringify(prepareExportJobs([job], true));
    const publicReport = JSON.stringify(buildReport(job));
    for (const text of [masked, publicReport])
      expect(text).not.toMatch(
        /phaseEvidence|phasePlan|startDocumentMs|triggerDurationMs/,
      );
    expect(o.phaseEvidence).toBeDefined();
  });
});
