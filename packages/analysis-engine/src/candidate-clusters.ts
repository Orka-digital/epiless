import type { Finding, SpatialEvidence } from '@epi-less/core';

import { balancedCheckerboard, exactCheckerboardInverse } from './spatial.js';

import {
  type ClusterContext,
  consumeComponent,
  measureActiveArea,
} from './candidate-components.js';
import {
  OpposingPairHistory,
  TransitionHistory,
} from './transition-history.js';

/** Collect candidates from the exact active mask while retaining same-frame spatial evidence. */
export function collectCandidates(
  context: ClusterContext,
  history: TransitionHistory | OpposingPairHistory,
  type: Finding['type'],
  ended: number,
): void {
  if (!history.hasActive) return;
  const pixels = context.width * context.height;
  const fullMask = history.activeCount === pixels;
  const calibration = !context.downsampled ? context.visualField : undefined;
  const area = measureActiveArea(
    context,
    history,
    calibration,
    fullMask,
    pixels,
  );
  for (let seed = history.firstActive; seed <= history.lastActive; seed++) {
    if (!history.active[seed]) continue;
    const { region, started, tail } = consumeComponent(
      context,
      history,
      seed,
      ended,
      fullMask,
      pixels,
    );
    const existing = context.findings.find(
      (finding, index) =>
        index >= context.mergeFrom &&
        finding.type === type &&
        ended - finding.endMs <= 1000 &&
        finding.region?.x === region.x &&
        finding.region?.y === region.y &&
        finding.region.width === region.width &&
        finding.region.height === region.height,
    );
    const retainSpatial = shouldRetainSpatial(
      existing,
      context.findings.length,
      area?.maximumPixels,
      history.activeCount,
      tail,
    );
    const pattern = candidatePattern(
      context,
      retainSpatial,
      tail,
      region,
      calibration,
      ended,
    );
    // Keep one actual strongest spatial witness, with its own time. The
    // diagnostic trace and live source event still describe first detection.
    const spatial: SpatialEvidence | undefined = retainSpatial
      ? {
          version: 1,
          coordinateSpace: 'ANALYSIS_PIXELS',
          analysisWidth: context.width,
          analysisHeight: context.height,
          sampledAtMs: ended,
          componentPixels: tail,
          simultaneousPixels: history.activeCount,
          simultaneousRatio: history.activeCount / pixels,
          maskBasis: 'QUALIFYING_TRANSITIONS_SAME_FRAME',
          ...(area && calibration
            ? {
                visualField: {
                  ...calibration,
                  maximumPixels: area.maximumPixels,
                  maximumRatio: area.maximumRatio,
                  thresholdRatio: area.thresholdRatio,
                  exceedsThreshold: area.exceedsThreshold,
                  window: area.window,
                },
              }
            : {}),
          pattern,
          motion: context.currentMotion,
        }
      : undefined;
    if (existing) {
      if (spatial) existing.spatial = spatial;
      existing.endMs = ended;
      existing.affectedRatio = Math.max(existing.affectedRatio, tail / pixels);
    } else if (context.findings.length < 100) {
      const finding: Finding = {
        id: `candidate-${context.findings.length + 1}`,
        type,
        severity: 'warning',
        reviewStatus: 'NEEDS_REVIEW',
        startMs: started,
        endMs: ended,
        flashesInWindow: 3.5,
        qualifyingTransitions: 7,
        affectedRatio: tail / pixels,
        region,
        spatial: spatial!,
        ...(context.diagnosticHistory
          ? {
              diagnostic: context.diagnosticHistory.evidence(
                seed,
                history.started(context.representatives[seed]),
                ended,
                context.sourceWidth,
                context.sourceHeight,
              ),
            }
          : {}),
        message: `At least seven qualifying ${type === 'RED_FLASH' ? 'saturated-red chromaticity' : 'luminance'} transitions (three opposing pairs and a continuation) within a rolling second in this region. Candidate only; area and normative conditions require review.`,
      };
      context.findings.push(finding);
      context.onCandidate?.(structuredClone(finding));
    } else
      context.notes.add(
        'The 100-candidate reporting limit was reached; additional candidates are omitted.',
      );
    // A full mask has exactly one component. The mask is already cleared;
    // scanning the remaining zeroes cannot discover another component.
    if (fullMask) break;
  }
}

function shouldRetainSpatial(
  existing: Finding | undefined,
  findingCount: number,
  maximumPixels: number | undefined,
  activeCount: number,
  tail: number,
): boolean {
  const previousSpatial = existing?.spatial;
  const currentMaximum = maximumPixels ?? activeCount;
  const previousMaximum = previousSpatial
    ? (previousSpatial.visualField?.maximumPixels ??
      previousSpatial.simultaneousPixels)
    : -1;
  return (
    (existing !== undefined || findingCount < 100) &&
    (!previousSpatial ||
      currentMaximum > previousMaximum ||
      (currentMaximum === previousMaximum &&
        (activeCount > previousSpatial.simultaneousPixels ||
          (activeCount === previousSpatial.simultaneousPixels &&
            tail > previousSpatial.componentPixels))))
  );
}

function candidatePattern(
  context: ClusterContext,
  retainSpatial: boolean,
  tail: number,
  region: NonNullable<Finding['region']>,
  calibration: ClusterContext['visualField'] | undefined,
  ended: number,
): SpatialEvidence['pattern'] {
  const pattern: SpatialEvidence['pattern'] =
    retainSpatial &&
    tail === region.width * region.height &&
    context.currentRgba
      ? balancedCheckerboard(
          context.currentRgba,
          context.width,
          region,
          calibration,
        )
      : { kind: 'NONE_DEMONSTRATED', automaticallyExcluded: false };
  if (pattern.kind === 'EXACT_BALANCED_CHECKERBOARD' && context.currentRgba) {
    const inverse = exactCheckerboardInverse(
      context.currentRgba,
      context.previousFrame,
      context.width,
      region,
      context.previousFrameAtMs,
      ended,
    );
    if (inverse) pattern.inversePhase = inverse;
  }
  return pattern;
}
