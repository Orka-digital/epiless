import type { AuditReport } from '@epi-less/core';
/** Copy only published capture-quality fields; unknown imported fields never cross this boundary. */
export function copyPublicQuality(
  quality: AuditReport['routes'][number]['scenarios'][number]['quality'],
): typeof quality {
  return {
    frameCount: quality.frameCount,
    effectiveFps: quality.effectiveFps,
    maxGapMs: quality.maxGapMs,
    width: quality.width,
    height: quality.height,
    downsampled: quality.downsampled,
    interrupted: quality.interrupted,
    ...(quality.spatial
      ? {
          spatial: {
            mode: quality.spatial.mode,
            sourceWidth: quality.spatial.sourceWidth,
            sourceHeight: quality.spatial.sourceHeight,
            retainedResolutionRatio: quality.spatial.retainedResolutionRatio,
            stateBytes: quality.spatial.stateBytes,
            stateBudgetBytes: quality.spatial.stateBudgetBytes,
            tileSharing: quality.spatial.tileSharing,
            colorAssumption: quality.spatial.colorAssumption,
          },
        }
      : {}),
    ...(quality.processing
      ? {
          processing: {
            measuredFrames: quality.processing.measuredFrames,
            meanMs: quality.processing.meanMs,
            maxMs: quality.processing.maxMs,
            framesOver16_7Ms: quality.processing.framesOver16_7Ms,
            scope: quality.processing.scope,
            ...(quality.processing.conversionMeanMs !== undefined
              ? {
                  conversionMeanMs: quality.processing.conversionMeanMs,
                }
              : {}),
            ...(quality.processing.analysisMeanMs !== undefined
              ? {
                  analysisMeanMs: quality.processing.analysisMeanMs,
                }
              : {}),
            ...(quality.processing.conversionMethods
              ? {
                  conversionMethods: [...quality.processing.conversionMethods],
                }
              : {}),
            ...(quality.processing.track
              ? {
                  track: {
                    ...(quality.processing.track.width !== undefined
                      ? {
                          width: quality.processing.track.width,
                        }
                      : {}),
                    ...(quality.processing.track.height !== undefined
                      ? {
                          height: quality.processing.track.height,
                        }
                      : {}),
                    ...(quality.processing.track.frameRate !== undefined
                      ? {
                          frameRate: quality.processing.track.frameRate,
                        }
                      : {}),
                    ...(quality.processing.track.resizeMode !== undefined
                      ? {
                          resizeMode: quality.processing.track.resizeMode,
                        }
                      : {}),
                  },
                }
              : {}),
            ...(quality.processing.decoded
              ? {
                  decoded: {
                    codedWidth: quality.processing.decoded.codedWidth,
                    codedHeight: quality.processing.decoded.codedHeight,
                    displayWidth: quality.processing.decoded.displayWidth,
                    displayHeight: quality.processing.decoded.displayHeight,
                    format: quality.processing.decoded.format,
                    primaries: quality.processing.decoded.primaries,
                    transfer: quality.processing.decoded.transfer,
                    matrix: quality.processing.decoded.matrix,
                    ...(quality.processing.decoded.visibleRect
                      ? {
                          visibleRect: {
                            x: quality.processing.decoded.visibleRect.x,
                            y: quality.processing.decoded.visibleRect.y,
                            width: quality.processing.decoded.visibleRect.width,
                            height:
                              quality.processing.decoded.visibleRect.height,
                          },
                        }
                      : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(quality.captureWindowMs !== undefined
      ? { captureWindowMs: quality.captureWindowMs }
      : {}),
    ...(quality.leadingIdleMs !== undefined
      ? { leadingIdleMs: quality.leadingIdleMs }
      : {}),
    ...(quality.trailingIdleMs !== undefined
      ? { trailingIdleMs: quality.trailingIdleMs }
      : {}),
  };
}
