import { describe, expect, it } from 'vitest';
import {
  actionPending,
  focusedAction,
  newExplorationState,
  recordActionAttempt,
  replayScenario,
  sameViewport,
} from '../../apps/chrome-extension/src/scenario-plan';
import { buildVerificationPlan } from '../../apps/chrome-extension/src/verification';
import type {
  PageInventory,
  ScanJob,
} from '../../apps/chrome-extension/src/model';

const carousel = (state: string): PageInventory['actions'][number] => ({
  id: 'next',
  kind: 'carousel',
  label: 'carousel',
  state,
  focusable: true,
  target: {
    kind: 'carousel',
    selectorPath: ['*:nth-child(1) > *:nth-child(2)'],
  },
});
describe('bounded and reproducible scenario planning', () => {
  it('explores several actual carousel transitions, stops cycles, and bounds a nonrepeating carousel', () => {
    const plan = newExplorationState();
    for (const state of ['slide0', 'slide1', 'slide2']) {
      expect(actionPending(carousel(state), plan)).toBe(true);
      recordActionAttempt(carousel(state), plan);
    }
    expect(actionPending(carousel('slide0'), plan)).toBe(false);
    expect(actionPending(carousel('slide3'), plan)).toBe(true);
    recordActionAttempt(carousel('slide3'), plan);
    expect(actionPending(carousel('slide4'), plan)).toBe(false);
  });
  it('does not retry a control whose transition never changed its state', () => {
    const plan = newExplorationState();
    recordActionAttempt(carousel('unchanged'), plan);
    expect(actionPending(carousel('unchanged'), plan)).toBe(false);
  });
  it('bounds focus separately and never focuses consent/media as a substitute for supported actions', () => {
    const plan = newExplorationState();
    expect(
      focusedAction([{ ...carousel('x'), kind: 'media' }], plan),
    ).toBeUndefined();
    expect(focusedAction([carousel('x')], plan)?.id).toBe('next');
    plan.focused.add('next');
    expect(focusedAction([carousel('x')], plan)).toBeUndefined();
    plan.focusCount = 2;
    expect(
      focusedAction([{ ...carousel('x'), id: 'another' }], plan),
    ).toBeUndefined();
  });
  it('distinguishes trigger-in-capture from delayed observation after the same prerequisites', () => {
    const viewport = { width: 1000, height: 700, dpr: 2 };
    const steps = [{ kind: 'wait' as const, durationMs: 2000 }];
    const delayed = replayScenario(
      'https://example.test/',
      viewport,
      steps,
      5000,
    );
    const trigger = replayScenario(
      'https://example.test/',
      viewport,
      steps,
      5000,
      'current',
      0,
    );
    expect(trigger.stateKey).not.toBe(delayed.stateKey);
    steps[0].durationMs = 999;
    expect(delayed.steps[0]).toEqual({ kind: 'wait', durationMs: 2000 });
    expect(sameViewport(viewport, { ...viewport, width: 999 })).toBe(false);
    expect(sameViewport(viewport, { ...viewport, dpr: 1 })).toBe(false);
  });
  it('replay refuses missing achieved provenance instead of silently accepting an attempted action', () => {
    const scan = {
      state: 'COMPLETED',
      tasks: [{ id: 'route', observations: [{ id: 'obs', achieved: false }] }],
    } as unknown as ScanJob;
    expect(() => buildVerificationPlan(scan, 'route', 'obs')).toThrow(
      'bereikt scenario',
    );
  });
});
