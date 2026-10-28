import { describe, expect, it, vi } from 'vitest';

import { type ScanJob } from '../../apps/chrome-extension/src/model';

import {
  appendReview,
  compareVerification,
  reviewSummary,
} from '../../apps/chrome-extension/src/verification';

import { anchor, baseline, repeated } from './verification.fixture';
describe('targeted verification and explicit local review', () => {
  it('requires a new comparable recurrence after resolution, then records explicit reopening', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    const base = baseline(),
      next = repeated(base);
    appendReview(base, {
      ...anchor,
      decision: 'CONFIRMED',
      note: 'Confirmed effect',
    });
    appendReview(
      base,
      {
        ...anchor,
        decision: 'RESOLVED',
        note: 'Effect removed',
        verificationJobId: next.id,
      },
      next,
    );
    const recurrence = repeated(base, true);
    recurrence.id = 'recurrence';
    expect(() =>
      appendReview(
        base,
        {
          ...anchor,
          decision: 'REOPENED',
          note: 'Reproduced effect',
          verificationJobId: recurrence.id,
        },
        recurrence,
      ),
    ).toThrow(/nieuwe/);
    recurrence.startedAt = '2026-01-02T12:00:00Z';
    recurrence.endedAt = '2026-01-02T12:00:10Z';
    vi.setSystemTime(new Date('2026-01-02T12:01:00Z'));
    appendReview(
      base,
      {
        ...anchor,
        decision: 'REOPENED',
        note: 'Reproduced after theme update',
        verificationJobId: recurrence.id,
      },
      recurrence,
    );
    expect(reviewSummary([base, next, recurrence])).toEqual({
      confirmed: 1,
      resolved: 0,
      reopened: 1,
      falsePositives: 0,
    });
    const resolve = (check: ScanJob) =>
      appendReview(
        base,
        {
          ...anchor,
          decision: 'RESOLVED',
          note: 'Reviewed repair',
          verificationJobId: check.id,
        },
        check,
      );
    expect(() => resolve(next)).toThrow(/nieuwe hercontrole/);
    // Reconfirming cannot erase the previous recurrence and recycle old evidence.
    appendReview(base, {
      ...anchor,
      decision: 'CONFIRMED',
      note: 'Still needs repair',
    });
    expect(() => resolve(next)).toThrow(/nieuwe hercontrole/);
    const fresh = repeated(base);
    fresh.id = 'new-repair';
    fresh.startedAt = '2026-01-03T12:00:00Z';
    fresh.endedAt = '2026-01-03T12:00:10Z';
    vi.setSystemTime(new Date('2026-01-03T12:01:00Z'));
    expect(() => resolve(fresh)).not.toThrow();
    expect(reviewSummary([base]).resolved).toBe(1);
  });

  it('will not treat a different nearby signal as proof the original issue disappeared', () => {
    const base = baseline(),
      next = repeated(base, true);
    next.tasks[0].observations[0].measurement!.findings[0].region!.x = 700;
    expect(compareVerification(base, anchor, next).status).toBe('INCOMPARABLE');
  });
});
