import type { Finding } from '@epi-less/core';
import type { SpatialEvidence } from '@epi-less/core';
import { DiagnosticHistory } from './diagnostic-history.js';
import {
  balancedCheckerboard,
  combinedMaskFieldAnalysis,
  exactCheckerboardInverse,
  type VisualFieldCalibration,
} from './spatial.js';
import {
  OpposingPairHistory,
  TransitionHistory,
} from './transition-history.js';

interface ClusterContext {
  readonly width: number;
  readonly height: number;
  readonly downsampled: boolean;
  readonly visualField: VisualFieldCalibration | undefined;
  readonly queue: Int32Array<ArrayBufferLike>;
  readonly representatives: Uint32Array<ArrayBufferLike>;
  readonly findings: Finding[];
  readonly mergeFrom: number;
  readonly currentRgba:
    | Uint8Array<ArrayBufferLike>
    | Uint8ClampedArray<ArrayBufferLike>
    | undefined;
  readonly previousFrame: Uint32Array<ArrayBufferLike> | undefined;
  readonly previousFrameAtMs: number | undefined;
  readonly currentMotion: SpatialEvidence['motion'];
  readonly diagnosticHistory: DiagnosticHistory | undefined;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly onCandidate: ((finding: Finding) => void) | undefined;
  readonly notes: Set<string>;
}
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
  const fullFieldPixels = calibration
    ? Math.min(context.width, calibration.widthPx) *
      Math.min(context.height, calibration.heightPx)
    : 0;
  const area = calibration
    ? fullMask
      ? {
          // The exact active count already proves every source pixel is one.
          // Every maximal overlap ties; retain the generic solver's first
          // window and full field denominator, including outside the image.
          totalPixels: pixels,
          maximumPixels: fullFieldPixels,
          fieldWidth: calibration.widthPx,
          fieldHeight: calibration.heightPx,
          maximumRatio:
            fullFieldPixels / (calibration.widthPx * calibration.heightPx),
          thresholdRatio: 0.25 as const,
          exceedsThreshold:
            fullFieldPixels * 4 > calibration.widthPx * calibration.heightPx,
          window: {
            x: 0,
            y: 0,
            width: calibration.widthPx,
            height: calibration.heightPx,
          },
        }
      : combinedMaskFieldAnalysis(
          history.active,
          context.width,
          context.height,
          calibration.widthPx,
          calibration.heightPx,
        )
    : undefined;
  for (let seed = history.firstActive; seed <= history.lastActive; seed++) {
    if (!history.active[seed]) continue;
    let head = 0;
    let tail = 1;
    let minX = context.width,
      minY = context.height,
      maxX = 0,
      maxY = 0,
      started = ended;
    context.queue[0] = seed;
    history.active[seed] = 0;
    if (fullMask) {
      // A homogeneous/full active mask is one exact connected component.
      // Avoid a multi-million-element flood fill on the most severe case.
      head = tail = pixels;
      minX = minY = 0;
      maxX = context.width - 1;
      maxY = context.height - 1;
      started = history.earliestActive;
      history.active.fill(0);
    }
    while (head < tail) {
      const pixel = context.queue[head++];
      const x = pixel % context.width;
      const y = Math.floor(pixel / context.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      started = Math.min(
        started,
        history.started(context.representatives[pixel]),
      );
      // Keep this allocation-free: a closure per native pixel made a full-HD
      // candidate pause the worker for hundreds of milliseconds.
      if (x > 0 && history.active[pixel - 1]) {
        history.active[pixel - 1] = 0;
        context.queue[tail++] = pixel - 1;
      }
      if (x + 1 < context.width && history.active[pixel + 1]) {
        history.active[pixel + 1] = 0;
        context.queue[tail++] = pixel + 1;
      }
      if (y > 0 && history.active[pixel - context.width]) {
        history.active[pixel - context.width] = 0;
        context.queue[tail++] = pixel - context.width;
      }
      if (y + 1 < context.height && history.active[pixel + context.width]) {
        history.active[pixel + context.width] = 0;
        context.queue[tail++] = pixel + context.width;
      }
    }
    const region = {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };
    const existing = context.findings.find(
      (finding, index) =>
        index >= context.mergeFrom &&
        finding.type === type &&
        ended - finding.endMs <= 1000 &&
        finding.region?.x === minX &&
        finding.region?.y === minY &&
        finding.region.width === region.width &&
        finding.region.height === region.height,
    );
    const previousSpatial = existing?.spatial;
    const currentMaximum = area?.maximumPixels ?? history.activeCount;
    const previousMaximum = previousSpatial
      ? (previousSpatial.visualField?.maximumPixels ??
        previousSpatial.simultaneousPixels)
      : -1;
    const retainSpatial =
      (existing !== undefined || context.findings.length < 100) &&
      (!previousSpatial ||
        currentMaximum > previousMaximum ||
        (currentMaximum === previousMaximum &&
          (history.activeCount > previousSpatial.simultaneousPixels ||
            (history.activeCount === previousSpatial.simultaneousPixels &&
              tail > previousSpatial.componentPixels))));
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
