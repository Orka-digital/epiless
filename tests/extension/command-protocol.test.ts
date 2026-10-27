import { describe, expect, it } from 'vitest';
import { parseBackgroundCommand } from '../../apps/chrome-extension/src/command-protocol';

describe('background command boundary', () => {
  it.each([
    null,
    {},
    { type: 'UNKNOWN' },
    { type: 'STOP' },
    { type: 'STOP', id: '' },
    { type: 'START', tabId: -1 },
    { type: 'START', tabId: 1, viewportSeconds: Infinity },
    { type: 'START', tabId: 1, advancedPointer: 'yes' },
    { type: 'START', tabId: 1, replayOf: { jobId: 'job' } },
    { type: 'GET_STATE', target: 'offscreen' },
    { type: 'GET_STATE', unexpected: true },
    { type: 'SET_HISTORY_SETTINGS', settings: { detailRetentionDays: 0 } },
  ])('rejects malformed or ambiguous input: %j', (input) => {
    expect(() => parseBackgroundCommand(input)).toThrow(
      'Ongeldig extensiebericht',
    );
  });
  it.each([
    { type: 'GET_STATE' },
    { type: 'START', tabId: 1 },
    {
      type: 'START',
      tabId: 2,
      mode: 'AUTONOMOUS',
      viewportSeconds: 30,
      replayOf: { jobId: 'job', taskId: 'task', observationId: 'observation' },
    },
    { type: 'SET_HISTORY_SETTINGS', settings: { detailRetentionDays: null } },
    { type: 'SET_SCAN_PREFERENCES', mode: 'QUICK', viewportSeconds: 15 },
    {
      type: 'CAPTURE_LOST',
      target: 'background',
      generation: 'generation',
      sourceId: 'source',
    },
  ])('preserves valid commands: %j', (input) => {
    expect(parseBackgroundCommand(input)).toEqual(input);
  });
  const candidate = {
    type: 'CANDIDATE_EVENT',
    generation: 'generation',
    segmentId: 'segment',
    findingId: 'finding',
    windowStartMs: 0,
    windowEndMs: 100,
    windowStartEpochMs: 1000,
    windowEndEpochMs: 1100,
    clockBasis: 'FRAME_RECEIPT_ESTIMATE',
    alignmentUncertaintyMs: null,
    analysis: { width: 100, height: 100 },
    source: { width: 1000, height: 1000 },
    region: { x: 50, y: 50, width: 50, height: 50 },
  };
  it('accepts aligned candidate bounds including the frame edge', () => {
    expect(parseBackgroundCommand(candidate)).toEqual(candidate);
  });
  it.each([
    { windowEndMs: -1 },
    { windowStartEpochMs: 1200 },
    { region: { x: 51, y: 50, width: 50, height: 50 } },
  ])('rejects reversed windows or out-of-frame candidates: %j', (changes) => {
    expect(() =>
      parseBackgroundCommand({ ...candidate, ...changes }),
    ).toThrow();
  });
});
