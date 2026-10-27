import { describe, expect, it } from 'vitest';
import { evaluateNumericCorpus } from '../validation/run.js';
import { referenceStepSequence } from '../validation/reference.js';

describe('independent numeric batch reference', () => {
  it('agrees with the deterministic threshold, phase, red and discontinuity corpus', () => {
    const report = evaluateNumericCorpus();
    expect(report.cases).toBeGreaterThan(1500);
    expect(report.general.truePositive).toBeGreaterThan(100);
    expect(report.general.trueNegative).toBeGreaterThan(100);
    expect(report.red.truePositive).toBeGreaterThan(100);
    expect(report.red.trueNegative).toBeGreaterThan(100);
    expect(report.mismatches).toEqual([]);
    expect(report.matchedCases).toBe(report.cases);
  });
  it('does not count overlapping transition pairs as more than three cycles', () => {
    expect(
      referenceStepSequence(
        Array.from({ length: 7 }, (_, i) => ({
          time: i * 100,
          rgb: [i % 2 ? 255 : 0, 0, 0] as const,
        })),
      ),
    ).toEqual({ general: false, red: false });
  });
});
