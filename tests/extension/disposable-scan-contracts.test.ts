import { describe, expect, it } from 'vitest';

import {
  ADVANCED_SCAN_OWNER_KEY,
  matchingRecord,
  validOwnedStart,
} from '../../apps/chrome-extension/src/disposable-scan';
import { prepared } from './disposable-scan.fixture';
describe('disposable scan ownership records', () => {
  it('has one explicit storage key and compares all JSON fields independent of key insertion order', () => {
    expect(ADVANCED_SCAN_OWNER_KEY).toBe('advanced-scan-owner');
    const owner = { ...prepared(), extra: { a: 1, b: ['x', 'y'] } };
    const reordered = { extra: { b: ['x', 'y'], a: 1 }, ...prepared() };
    expect(JSON.stringify(owner)).not.toBe(JSON.stringify(reordered));
    expect(matchingRecord(owner, reordered)).toBe(true);
    reordered.extra.b.reverse();
    expect(matchingRecord(owner, reordered)).toBe(false);
    expect(matchingRecord(prepared(), { ...prepared(), extra: true })).toBe(
      false,
    );
    expect(matchingRecord({ x: NaN }, { x: NaN })).toBe(false);
    expect(matchingRecord({ x: Infinity }, { x: Infinity })).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(matchingRecord(cyclic, cyclic)).toBe(false);
  });

  it.each(['PREPARED', 'PAUSED'] as const)(
    'accepts the exact owned start in %s',
    (phase) => {
      const owner = { ...prepared(), phase };
      expect(
        validOwnedStart(owner, {
          tabId: 40,
          url: owner.route,
          mode: owner.mode,
          viewportSeconds: 30,
          nonce: owner.nonce,
        }),
      ).toBe(true);
    },
  );

  it.each(['CREATE_INTENT', 'RUNNING', 'CLOSING', 'MANUAL'] as const)(
    'does not start or resume from %s',
    (phase) => {
      const owner = { ...prepared(), phase };
      expect(
        validOwnedStart(owner, {
          tabId: 40,
          url: owner.route,
          mode: owner.mode,
          viewportSeconds: 30,
        }),
      ).toBe(false);
    },
  );

  it.each([
    { tabId: 11 },
    { url: 'https://fixture.test/another-route' },
    { url: 'https://foreign.test/target' },
    { mode: 'QUICK' as const },
    { viewportSeconds: 31 },
    { nonce: 'stale-attempt' },
    {
      replayOf: { jobId: 'old', taskId: 'task', observationId: 'observation' },
    },
  ])('rejects changed authorization %j', (change) => {
    const owner = prepared();
    expect(
      validOwnedStart(owner, {
        tabId: 40,
        url: owner.route,
        mode: owner.mode,
        viewportSeconds: 30,
        ...change,
      }),
    ).toBe(false);
  });

  it('requires the exact replay reference and a route on the original source origin', () => {
    const owner = prepared();
    owner.replayOf = {
      jobId: 'old',
      taskId: 'task',
      observationId: 'observation',
    };
    const start = {
      tabId: 40,
      url: owner.route,
      mode: owner.mode,
      viewportSeconds: 30,
      replayOf: { ...owner.replayOf },
    };
    expect(validOwnedStart(owner, start)).toBe(true);
    expect(validOwnedStart(owner, { ...start, replayOf: undefined })).toBe(
      false,
    );
    owner.source.url = 'https://another-origin.test/original';
    expect(validOwnedStart(owner, start)).toBe(false);
  });
});
