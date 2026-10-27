import type { Finding } from '@epi-less/core';
import type { AnalysisResult } from './types.js';
interface FinalizationInput {
  last: number;
  first: number;
  count: number;
  invalid: boolean;
  interrupted: boolean;
  downsampled: boolean;
  minFps: number;
  gap: number;
  permittedGap: number;
  notes: Set<string>;
  findings: Finding[];
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  stateBytes: number;
}
/** Quality classification and numeric snapshot construction; no pixel-processing work. */
export function finishAnalysis(input: FinalizationInput): AnalysisResult {
  const duration = input.last - input.first;
  const fps =
    input.count > 1 && duration > 0 ? ((input.count - 1) * 1000) / duration : 0;
  const insufficient =
    input.invalid ||
    input.interrupted ||
    input.downsampled ||
    input.count < 2 ||
    duration < 1000 ||
    fps < input.minFps ||
    input.gap > input.permittedGap;
  if (duration < 1000)
    input.notes.add('Less than one second of usable capture was observed.');
  if (fps < input.minFps)
    input.notes.add(
      `Effective sampling was below ${input.minFps} fps; fast flashes may be missed.`,
    );
  if (input.gap > input.permittedGap)
    input.notes.add(
      `Capture gaps exceeded ${input.permittedGap} ms; transitions across gaps were discarded.`,
    );
  input.notes.add(
    'Unvalidated candidate engine: no WCAG PASS or NON_CONFORMANT verdict. SDR sRGB is assumed; HDR and colour-management accuracy are not validated.',
  );
  input.notes.add(
    'Reported area is a measured pixel ratio, not the WCAG visual-field threshold. Fine patterns, DOM attribution and red black-point chromaticity are not validated.',
  );
  return {
    status: insufficient
      ? 'INCONCLUSIVE'
      : input.findings.length
        ? 'NEEDS_REVIEW'
        : 'NO_ISSUES_OBSERVED',
    passed: null,
    quality: {
      frameCount: input.count,
      effectiveFps: fps,
      maxGapMs: input.gap,
      width: input.width,
      height: input.height,
      downsampled: input.downsampled,
      interrupted: input.interrupted,
      ...(input.count
        ? {
            spatial: {
              mode: input.downsampled
                ? ('RESCALED_PIXELS' as const)
                : ('NATIVE_PIXELS' as const),
              sourceWidth: input.sourceWidth,
              sourceHeight: input.sourceHeight,
              retainedResolutionRatio: Math.min(
                1,
                (input.width * input.height) /
                  (input.sourceWidth * input.sourceHeight),
              ),
              stateBytes: input.stateBytes,
              stateBudgetBytes: 268435456 as const,
              tileSharing: 'LOSSLESS_IDENTICAL_HISTORY' as const,
              colorAssumption: 'SDR_SRGB_8BIT' as const,
            },
          }
        : {}),
    },
    findings: structuredClone(input.findings),
    limitations: [...input.notes],
  };
}
