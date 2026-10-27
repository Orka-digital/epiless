import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  copyPhaseEvidence,
  phaseComparisonReasons,
  phasePlanFromEvidence,
  phasePlanKey,
  validPhaseEvidence,
  validPhasePlan,
  type PhaseEvidence,
  type AnimationPhaseRecord,
} from '../../apps/chrome-extension/src/animation-phase';
import type {
  Observation,
  ScanJob,
} from '../../apps/chrome-extension/src/model';
import type { Finding } from '@epi-less/core';
import { prepareExportJobs } from '../../apps/chrome-extension/src/export';
import { buildReport } from '../../apps/chrome-extension/src/report';
const clock = (time: number) => ({
  documentMs: time,
  timelineMs: time,
  epochMs: 100_000 + time,
});
const animation = (
  origin: AnimationPhaseRecord['origin'] = 'DOCUMENT',
): AnimationPhaseRecord => ({
  selectorPath: ['div:nth-child(1)'],
  kind: 'CSS_ANIMATION',
  ordinal: 0,
  origin,
  first: {
    clock: clock(1000),
    currentTimeMs: 1000,
    startTimeMs: 0,
    playbackRate: 1,
    playState: 'running',
    durationMs: 10000,
    delayMs: 0,
    iterations: 1,
  },
  last: {
    clock: clock(3000),
    currentTimeMs: 3000,
    startTimeMs: 0,
    playbackRate: 1,
    playState: 'running',
    durationMs: 10000,
    delayMs: 0,
    iterations: 1,
  },
});
const evidence = (): PhaseEvidence => ({
  version: 1,
  complete: true,
  reasons: [],
  start: clock(1000),
  end: clock(3000),
  animations: [animation()],
});
const observation = (e: PhaseEvidence) =>
  ({
    phaseEvidence: e,
    replay: { phasePlan: phasePlanFromEvidence(e) },
  }) as Observation;
const finding = (): Finding =>
  ({
    sourceTimeline: {
      status: 'CORRELATED',
      complete: true,
      windowStartEpochMs: 101200,
      windowEndEpochMs: 102000,
      frameClock: { startBoundaryErrorMs: 1, endBoundaryErrorMs: 1 },
      candidates: [{ selectorPath: ['div:nth-child(1)'] }],
    },
  }) as Finding;
describe('bounded document and animation phase replay', () => {
  it('rejects a fresh early replay of the same delayed document effect', () => {
    const before = observation(evidence()),
      after = observation(evidence());
    after.phaseEvidence!.start = clock(10);
    after.phaseEvidence!.end = clock(2010);
    after.phaseEvidence!.animations = [];
    expect(phaseComparisonReasons(before, after, finding())).toEqual([
      'DOCUMENT_PHASE_INTERVAL_NOT_COVERED',
    ]);
  });
  it('requires both ends, with only numeric rounding allowance', () => {
    for (const field of ['start', 'end'] as const) {
      const after = observation(evidence());
      after.phaseEvidence![field] = clock(field === 'start' ? 1003 : 2997);
      after.phaseEvidence!.animations = [];
      expect(phaseComparisonReasons(observation(evidence()), after)).toEqual([
        'DOCUMENT_PHASE_INTERVAL_NOT_COVERED',
      ]);
    }
  });
  it('accepts a covered interval with a removed effect', () => {
    const after = evidence();
    after.start = clock(900);
    after.end = clock(3100);
    after.animations = [];
    expect(
      phaseComparisonReasons(
        observation(evidence()),
        observation(after),
        finding(),
      ),
    ).toEqual([]);
  });
  it('does not require keyframe colours, animation names or contents to remain equal', () => {
    const e = evidence();
    Object.assign(e.animations[0], {
      keyframes: [{ backgroundColor: 'secret-page-value' }],
      animationName: 'private-effect',
    });
    const copied = copyPhaseEvidence(e)!;
    expect(JSON.stringify(copied)).not.toMatch(
      /secret|private-effect|keyframes|animationName/,
    );
    expect(
      phaseComparisonReasons(
        observation(evidence()),
        observation(copied),
        finding(),
      ),
    ).toEqual([]);
  });
  it('rejects equal document windows when an existing animation actually started later', () => {
    const e = evidence();
    for (const state of [e.animations[0].first, e.animations[0].last]) {
      state.startTimeMs = 500;
      state.currentTimeMs -= 500;
    }
    expect(
      phaseComparisonReasons(observation(evidence()), observation(e)),
    ).toEqual(['ANIMATION_PHASE_INTERVAL_NOT_COVERED']);
  });
  it('records trigger correlation only for complete in-window exact sources', () => {
    const e = evidence();
    e.trigger = { before: clock(1000), after: clock(1010) };
    e.animations[0].origin = 'TRIGGER';
    expect(phasePlanFromEvidence(e, [finding()], true).mode).toBe('TRIGGER');
    for (const mutate of [
      (f: Finding) => {
        f.sourceTimeline!.complete = false;
      },
      (f: Finding) => {
        delete f.sourceTimeline;
      },
      (f: Finding) => {
        f.sourceTimeline!.candidates.push(f.sourceTimeline!.candidates[0]);
      },
    ]) {
      const f = finding();
      mutate(f);
      expect(phasePlanFromEvidence(e, [f], true).mode).toBe('DOCUMENT');
    }
    e.animations.push(animation());
    expect(phasePlanFromEvidence(e, [finding()], true).mode).toBe('DOCUMENT');
  });
  it('requires the original document interval even for a removed action-correlated effect', () => {
    const base = evidence();
    base.trigger = { before: clock(1000), after: clock(1010) };
    base.animations[0].origin = 'TRIGGER';
    base.animations[0].first.startTimeMs = 1000;
    base.animations[0].first.currentTimeMs = 0;
    base.animations[0].last.startTimeMs = 1000;
    base.animations[0].last.currentTimeMs = 2000;
    const original = observation(base);
    original.replay!.phasePlan = phasePlanFromEvidence(base, [finding()], true);
    const next = evidence();
    next.start = clock(10000);
    next.end = clock(12010);
    next.trigger = { before: clock(10000), after: clock(10010) };
    next.animations = [];
    expect(
      phaseComparisonReasons(original, observation(next), finding()),
    ).toEqual(['DOCUMENT_PHASE_INTERVAL_NOT_COVERED']);
    // Removal remains a legitimate fix when both document and action intervals
    // are covered. A nearby action alone never proves a causal reset.
    next.start = clock(900);
    next.end = clock(3100);
    next.trigger = { before: clock(1000), after: clock(1010) };
    expect(
      phaseComparisonReasons(original, observation(next), finding()),
    ).toEqual([]);
    next.trigger = { before: clock(1200), after: clock(1210) };
    expect(phaseComparisonReasons(original, observation(next))).toEqual([
      'TRIGGER_PHASE_INTERVAL_NOT_COVERED',
    ]);
  });
  it('rejects an unchanged document-timer effect coincidentally classified as triggered', () => {
    const base = evidence();
    base.start = clock(4990);
    base.end = clock(7000);
    base.trigger = { before: clock(4990), after: clock(4992) };
    const effect = base.animations[0];
    effect.origin = 'TRIGGER';
    effect.first.clock = clock(5010);
    effect.first.startTimeMs = 5000;
    effect.first.currentTimeMs = 10;
    effect.last.clock = clock(7000);
    effect.last.startTimeMs = 5000;
    effect.last.currentTimeMs = 1000;
    effect.first.durationMs = effect.last.durationMs = 1000;
    const candidate = finding();
    candidate.sourceTimeline!.windowStartEpochMs = 105100;
    candidate.sourceTimeline!.windowEndEpochMs = 105900;
    const original = observation(base);
    original.replay!.phasePlan = phasePlanFromEvidence(base, [candidate], true);
    expect(original.replay!.phasePlan!.mode).toBe('TRIGGER');
    const later: PhaseEvidence = {
      version: 1,
      complete: true,
      reasons: [],
      start: clock(10000),
      end: clock(12010),
      trigger: { before: clock(10000), after: clock(10002) },
      animations: [],
    };
    expect(
      phaseComparisonReasons(original, observation(later), candidate),
    ).toEqual(['DOCUMENT_PHASE_INTERVAL_NOT_COVERED']);
  });
  it('does not silently excuse an ambient animation on replay as the triggered effect', () => {
    const e = evidence();
    e.trigger = { before: clock(1000), after: clock(1010) };
    e.animations[0].origin = 'TRIGGER';
    const before = observation(e);
    before.replay!.phasePlan = phasePlanFromEvidence(e, [finding()], true);
    const after = structuredClone(before);
    after.phaseEvidence!.animations[0].origin = 'DOCUMENT';
    expect(phaseComparisonReasons(before, after)).toEqual([
      'ANIMATION_TRIGGER_NOT_REPRODUCED',
    ]);
  });
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
