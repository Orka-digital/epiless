import { ENGINE_VERSION, FrameAnalyzer } from '../src/index.js';
import { numericCorpus, boundaryProbes } from './corpus.js';
import { referenceStepSequence } from './reference.js';

export function evaluateNumericCorpus() {
  const cases = numericCorpus();
  const outcomes = cases.map((input) => {
    const reference = referenceStepSequence(input.samples);
    const analyzer = new FrameAnalyzer({ diagnostics: false });
    for (const sample of input.samples) {
      if (sample.interrupted)
        analyzer.markInterrupted('Numeric reference discontinuity');
      analyzer.pushFrame({
        rgba: new Uint8Array([...sample.rgb, sample.alpha ?? 255]),
        width: 1,
        height: 1,
        timestampMs: sample.time,
        sourceWidth: sample.sourceWidth,
      });
    }
    const report = analyzer.finish();
    const actual = {
      general: report.findings.some(
        (finding) => finding.type === 'GENERAL_FLASH',
      ),
      red: report.findings.some((finding) => finding.type === 'RED_FLASH'),
    };
    return {
      id: input.id,
      family: input.family,
      reference,
      actual,
      matches:
        reference.general === actual.general && reference.red === actual.red,
    };
  });
  const matrix = (kind: 'general' | 'red') => ({
    truePositive: outcomes.filter(
      (item) => item.reference[kind] && item.actual[kind],
    ).length,
    trueNegative: outcomes.filter(
      (item) => !item.reference[kind] && !item.actual[kind],
    ).length,
    falsePositive: outcomes.filter(
      (item) => !item.reference[kind] && item.actual[kind],
    ).length,
    falseNegative: outcomes.filter(
      (item) => item.reference[kind] && !item.actual[kind],
    ).length,
  });
  return {
    schemaVersion: 1,
    engineVersion: ENGINE_VERSION,
    corpus: 'numeric-step-reference-v1',
    seed: '0x5eed2301',
    scope:
      'One opaque analysis pixel, SDR sRGB step sequences. Independent batch arithmetic and exhaustive pairing oracle; internal regression agreement only, not external validation, screen-area assessment or WCAG conformance.',
    source:
      'https://www.w3.org/TR/WCAG22/#dfn-general-flash-and-red-flash-thresholds',
    cases: outcomes.length,
    matchedCases: outcomes.filter((item) => item.matches).length,
    general: matrix('general'),
    red: matrix('red'),
    boundaries: boundaryProbes(),
    families: [...new Set(outcomes.map((item) => item.family))].map(
      (family) => ({
        family,
        cases: outcomes.filter((item) => item.family === family).length,
        matchedCases: outcomes.filter(
          (item) => item.family === family && item.matches,
        ).length,
      }),
    ),
    mismatches: outcomes.filter((item) => !item.matches),
  };
}
