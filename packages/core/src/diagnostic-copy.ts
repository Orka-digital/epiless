import type { Finding } from './report.js';

import type { SourceTimeline } from './source-timeline-schema.js';

import type { SpatialEvidence } from './spatial.js';

/** Deep allowlist for optional public diagnostics. Never propagate local-only fields. */
export function copyDiagnostics(
  finding: Finding,
): Pick<Finding, 'diagnostic' | 'source' | 'sourceTimeline' | 'spatial'> {
  const rect = (r: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  const d = finding.diagnostic,
    s = finding.source;
  return {
    ...(d
      ? {
          diagnostic: {
            version: d.version,
            coordinateSpace: d.coordinateSpace,
            point: { x: d.point.x, y: d.point.y },
            analysisWidth: d.analysisWidth,
            analysisHeight: d.analysisHeight,
            sourceWidth: d.sourceWidth,
            sourceHeight: d.sourceHeight,
            windowStartMs: d.windowStartMs,
            windowEndMs: d.windowEndMs,
            complete: d.complete,
            samples: d.samples.map((v) => ({
              timestampMs: v.timestampMs,
              red: v.red,
              green: v.green,
              blue: v.blue,
            })),
            ...(d.omissions ? { omissions: [...d.omissions] } : {}),
          },
        }
      : {}),
    ...(s
      ? {
          source: {
            status: s.status,
            ...(s.reason ? { reason: s.reason } : {}),
            coordinateSpace: s.coordinateSpace,
            sampledAt: s.sampledAt,
            delayMs: s.delayMs,
            ...(s.viewport
              ? {
                  viewport: {
                    width: s.viewport.width,
                    height: s.viewport.height,
                    dpr: s.viewport.dpr,
                    scrollX: s.viewport.scrollX,
                    scrollY: s.viewport.scrollY,
                  },
                }
              : {}),
            sampledPoints: s.sampledPoints,
            ...(s.region ? { region: rect(s.region) } : {}),
            candidates: s.candidates.map((v) => ({
              selectorPath: [...v.selectorPath],
              tag: v.tag,
              rect: rect(v.rect),
              hitCount: v.hitCount,
              ...(v.media ? { media: v.media } : {}),
              animation: {
                running: v.animation.running,
                paused: v.animation.paused,
                finished: v.animation.finished,
              },
            })),
            limitations: [...s.limitations],
          },
        }
      : {}),
    ...(finding.sourceTimeline
      ? { sourceTimeline: copySourceTimeline(finding.sourceTimeline) }
      : {}),
    ...(finding.spatial
      ? { spatial: copySpatialEvidence(finding.spatial) }
      : {}),
  };
}

/** Copy the spatial evidence allowlist without carrying unknown imported properties into shared reports. */
export function copySpatialEvidence(s: SpatialEvidence): SpatialEvidence {
  return {
    version: s.version,
    coordinateSpace: s.coordinateSpace,
    analysisWidth: s.analysisWidth,
    analysisHeight: s.analysisHeight,
    sampledAtMs: s.sampledAtMs,
    componentPixels: s.componentPixels,
    simultaneousPixels: s.simultaneousPixels,
    simultaneousRatio: s.simultaneousRatio,
    maskBasis: s.maskBasis,
    ...(s.visualField
      ? {
          visualField: {
            basis: s.visualField.basis,
            reference: s.visualField.reference,
            widthPx: s.visualField.widthPx,
            heightPx: s.visualField.heightPx,
            maximumPixels: s.visualField.maximumPixels,
            maximumRatio: s.visualField.maximumRatio,
            thresholdRatio: s.visualField.thresholdRatio,
            exceedsThreshold: s.visualField.exceedsThreshold,
            window: {
              x: s.visualField.window.x,
              y: s.visualField.window.y,
              width: s.visualField.window.width,
              height: s.visualField.window.height,
            },
          },
        }
      : {}),
    pattern: {
      kind: s.pattern.kind,
      automaticallyExcluded: false,
      ...(s.pattern.cellWidthPx !== undefined
        ? { cellWidthPx: s.pattern.cellWidthPx }
        : {}),
      ...(s.pattern.cellHeightPx !== undefined
        ? { cellHeightPx: s.pattern.cellHeightPx }
        : {}),
      ...(s.pattern.inversePhase
        ? {
            inversePhase: {
              kind: s.pattern.inversePhase.kind,
              previousSampledAtMs: s.pattern.inversePhase.previousSampledAtMs,
              currentSampledAtMs: s.pattern.inversePhase.currentSampledAtMs,
              comparedPixels: s.pattern.inversePhase.comparedPixels,
              firstColorPixels: s.pattern.inversePhase.firstColorPixels,
              secondColorPixels: s.pattern.inversePhase.secondColorPixels,
            },
          }
        : {}),
      ...(s.pattern.belowPointOneDegree !== undefined
        ? { belowPointOneDegree: s.pattern.belowPointOneDegree }
        : {}),
    },
    motion: {
      kind: s.motion.kind,
      automaticallyExcluded: false,
      ...(s.motion.dx !== undefined ? { dx: s.motion.dx } : {}),
      ...(s.motion.dy !== undefined ? { dy: s.motion.dy } : {}),
      ...(s.motion.comparedPixels !== undefined
        ? { comparedPixels: s.motion.comparedPixels }
        : {}),
      ...(s.motion.overlapRatio !== undefined
        ? { overlapRatio: s.motion.overlapRatio }
        : {}),
    },
  };
}

/** Explicit public allowlist: inspection capabilities and unknown nested fields never leave the profile. */
export function copySourceTimeline(timeline: SourceTimeline): SourceTimeline {
  return {
    version: timeline.version,
    status: timeline.status,
    ...(timeline.reason ? { reason: timeline.reason } : {}),
    clockBasis: timeline.clockBasis,
    windowStartEpochMs: timeline.windowStartEpochMs,
    windowEndEpochMs: timeline.windowEndEpochMs,
    alignmentUncertaintyMs: timeline.alignmentUncertaintyMs,
    ...(timeline.frameClock
      ? {
          frameClock: {
            method: timeline.frameClock.method,
            matchedFrames: timeline.frameClock.matchedFrames,
            receiptOffsetSpreadMs: timeline.frameClock.receiptOffsetSpreadMs,
            startBoundaryErrorMs: timeline.frameClock.startBoundaryErrorMs,
            endBoundaryErrorMs: timeline.frameClock.endBoundaryErrorMs,
          },
        }
      : {}),
    sampledAt: timeline.sampledAt,
    sampleIntervalMs: timeline.sampleIntervalMs,
    maxSampleGapMs: timeline.maxSampleGapMs,
    sampleCount: timeline.sampleCount,
    ...(timeline.firstSampleEpochMs !== undefined
      ? { firstSampleEpochMs: timeline.firstSampleEpochMs }
      : {}),
    ...(timeline.lastSampleEpochMs !== undefined
      ? { lastSampleEpochMs: timeline.lastSampleEpochMs }
      : {}),
    complete: timeline.complete,
    candidates: timeline.candidates.map((c) => ({
      id: c.id,
      selectorPath: [...c.selectorPath],
      tag: c.tag,
      ...(c.media ? { media: c.media } : {}),
      observations: c.observations.map((o) => ({
        atEpochMs: o.atEpochMs,
        ...(o.readWindow
          ? {
              readWindow: {
                startEpochMs: o.readWindow.startEpochMs,
                endEpochMs: o.readWindow.endEpochMs,
                trigger: o.readWindow.trigger,
                ...(o.readWindow.renderEpochMs !== undefined
                  ? { renderEpochMs: o.readWindow.renderEpochMs }
                  : {}),
              },
            }
          : {}),
        rect: {
          x: o.rect.x,
          y: o.rect.y,
          width: o.rect.width,
          height: o.rect.height,
        },
        viewport: {
          width: o.viewport.width,
          height: o.viewport.height,
          dpr: o.viewport.dpr,
          scrollX: o.viewport.scrollX,
          scrollY: o.viewport.scrollY,
        },
        mutationsSincePrevious: o.mutationsSincePrevious,
        animations: o.animations.map((a) => ({
          kind: a.kind,
          playState: a.playState,
          durationMs: a.durationMs,
          delayMs: a.delayMs,
          iterations: a.iterations,
          currentTimeMs: a.currentTimeMs,
          progress: a.progress,
          properties: [...a.properties],
        })),
        ...(o.mediaTimeMs !== undefined ? { mediaTimeMs: o.mediaTimeMs } : {}),
        ...(o.mediaPaused !== undefined ? { mediaPaused: o.mediaPaused } : {}),
        ...(o.videoPresentation
          ? {
              videoPresentation: {
                callbackEpochMs: o.videoPresentation.callbackEpochMs,
                presentationEpochMs: o.videoPresentation.presentationEpochMs,
                expectedDisplayEpochMs:
                  o.videoPresentation.expectedDisplayEpochMs,
                mediaTimeMs: o.videoPresentation.mediaTimeMs,
                presentedFrames: o.videoPresentation.presentedFrames,
              },
            }
          : {}),
      })),
    })),
    limitations: [...timeline.limitations],
  };
}
