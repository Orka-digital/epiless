import { z } from 'zod';

const dimension = z.number().int().min(1).max(16384);
const pixels = z
  .number()
  .int()
  .nonnegative()
  .max(1920 * 1080);
const ratio = z.number().finite().min(0).max(1);
const rect = z.strictObject({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: dimension,
  height: dimension,
});

/** Numerical evidence, never a whole-site conformance or medical-safety verdict. */
export const spatialEvidenceSchema = z
  .strictObject({
    version: z.literal(1),
    coordinateSpace: z.literal('ANALYSIS_PIXELS'),
    analysisWidth: dimension,
    analysisHeight: dimension,
    sampledAtMs: z.number().finite().nonnegative(),
    componentPixels: pixels,
    simultaneousPixels: pixels,
    simultaneousRatio: ratio,
    // A transition-qualified mask for this decoded frame, not a union over time.
    maskBasis: z.literal('QUALIFYING_TRANSITIONS_SAME_FRAME'),
    visualField: z
      .strictObject({
        basis: z.enum([
          'EXPLICIT_CALIBRATION',
          'W3C_1024_768_REFERENCE',
          'W3C_CSS_REFERENCE',
        ]),
        reference: z.string().min(1).max(1000),
        widthPx: dimension,
        heightPx: dimension,
        maximumPixels: pixels,
        maximumRatio: ratio,
        thresholdRatio: z.literal(0.25),
        exceedsThreshold: z.boolean(),
        window: rect,
      })
      .optional(),
    pattern: z.strictObject({
      kind: z.enum(['EXACT_BALANCED_CHECKERBOARD', 'NONE_DEMONSTRATED']),
      cellWidthPx: dimension.optional(),
      cellHeightPx: dimension.optional(),
      belowPointOneDegree: z.boolean().optional(),
      inversePhase: z
        .strictObject({
          kind: z.literal('EXACT_TWO_FRAME_INVERSE'),
          previousSampledAtMs: z.number().finite().nonnegative(),
          currentSampledAtMs: z.number().finite().nonnegative(),
          comparedPixels: pixels,
          firstColorPixels: pixels,
          secondColorPixels: pixels,
        })
        .optional(),
      automaticallyExcluded: z.literal(false),
    }),
    motion: z.strictObject({
      kind: z.enum(['EXACT_TRANSLATION_COMPATIBLE', 'NONE_DEMONSTRATED']),
      dx: z.number().int().min(-8).max(8).optional(),
      dy: z.number().int().min(-8).max(8).optional(),
      comparedPixels: pixels.optional(),
      overlapRatio: ratio.optional(),
      automaticallyExcluded: z.literal(false),
    }),
  })
  .superRefine((v, ctx) => {
    const count = v.analysisWidth * v.analysisHeight;
    if (
      v.componentPixels > v.simultaneousPixels ||
      v.simultaneousPixels > count ||
      Math.abs(v.simultaneousRatio - v.simultaneousPixels / count) > 1e-10
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Spatial counts contradict image geometry',
      });
    const f = v.visualField;
    if (
      f &&
      (f.maximumPixels > v.simultaneousPixels ||
        f.window.width !== f.widthPx ||
        f.window.height !== f.heightPx ||
        Math.abs(f.maximumRatio - f.maximumPixels / (f.widthPx * f.heightPx)) >
          1e-10 ||
        f.exceedsThreshold !== f.maximumPixels * 4 > f.widthPx * f.heightPx)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Visual-field evidence contradicts exact mask counts',
      });
    if (
      v.pattern.kind === 'EXACT_BALANCED_CHECKERBOARD' &&
      (!v.pattern.cellWidthPx || !v.pattern.cellHeightPx)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Checkerboard evidence requires cell dimensions',
      });
    const inverse = v.pattern.inversePhase;
    if (
      inverse &&
      (v.pattern.kind !== 'EXACT_BALANCED_CHECKERBOARD' ||
        inverse.previousSampledAtMs >= inverse.currentSampledAtMs ||
        inverse.currentSampledAtMs !== v.sampledAtMs ||
        inverse.comparedPixels !== v.componentPixels ||
        inverse.firstColorPixels === 0 ||
        inverse.firstColorPixels !== inverse.secondColorPixels ||
        inverse.firstColorPixels + inverse.secondColorPixels !==
          inverse.comparedPixels)
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Inverse-phase witness must describe the same spatial frame and equal-area component',
      });
    if (
      v.motion.kind === 'EXACT_TRANSLATION_COMPATIBLE' &&
      (!v.motion.comparedPixels ||
        !v.motion.overlapRatio ||
        (v.motion.dx === 0 && v.motion.dy === 0) ||
        v.motion.dx === undefined ||
        v.motion.dy === undefined)
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Translation evidence requires a nonzero offset and verified overlap',
      });
  });
export type SpatialEvidence = z.infer<typeof spatialEvidenceSchema>;

export const spatialQualitySchema = z.strictObject({
  mode: z.enum(['NATIVE_PIXELS', 'RESCALED_PIXELS']),
  sourceWidth: dimension,
  sourceHeight: dimension,
  retainedResolutionRatio: ratio,
  stateBytes: z
    .number()
    .int()
    .nonnegative()
    .max(256 * 1024 * 1024),
  stateBudgetBytes: z.literal(256 * 1024 * 1024),
  tileSharing: z.literal('LOSSLESS_IDENTICAL_HISTORY'),
  colorAssumption: z.literal('SDR_SRGB_8BIT'),
});
export type SpatialQuality = z.infer<typeof spatialQualitySchema>;

export const processingQualitySchema = z.strictObject({
  measuredFrames: z.number().int().nonnegative(),
  meanMs: z.number().finite().nonnegative(),
  maxMs: z.number().finite().nonnegative(),
  framesOver16_7Ms: z.number().int().nonnegative(),
  scope: z.literal('WORKER_CONVERSION_AND_ANALYSIS'),
  conversionMeanMs: z.number().finite().nonnegative().optional(),
  analysisMeanMs: z.number().finite().nonnegative().optional(),
  // Execution evidence for this measured segment. The selected backend alone
  // does not prove kernel use: uniform/sparse frames may stay on the JS path.
  analysisBackend: z
    .strictObject({
      backend: z.enum(['WASM_DENSE', 'JS']),
      selectionReason: z.enum(['READY', 'FORCED_JS', 'UNAVAILABLE']),
      denseFrames: z.number().int().nonnegative(),
      inputCopiedBytes: z.number().int().nonnegative(),
      inputCopyMs: z.number().finite().nonnegative(),
      kernelMs: z.number().finite().nonnegative(),
      wasmMemoryBytes: z
        .number()
        .int()
        .nonnegative()
        .max(256 * 1024 * 1024),
      migratedStateBytes: z
        .number()
        .int()
        .nonnegative()
        .max(256 * 1024 * 1024),
      extraStateBytes: z
        .number()
        .int()
        .nonnegative()
        .max(256 * 1024 * 1024),
      engineStateBytes: z
        .number()
        .int()
        .nonnegative()
        .max(256 * 1024 * 1024),
      embeddedKernelBytes: z
        .number()
        .int()
        .nonnegative()
        .max(256 * 1024 * 1024),
    })
    .optional(),
  conversionMethods: z
    .array(z.enum(['VIDEOFRAME_COPY_RGBA', 'CANVAS2D_SRGB', 'RGBA_TRANSFER']))
    .max(3)
    .optional(),
  track: z
    .strictObject({
      width: dimension.optional(),
      height: dimension.optional(),
      frameRate: z.number().finite().nonnegative().optional(),
      resizeMode: z.string().max(40).optional(),
    })
    .optional(),
  decoded: z
    .strictObject({
      codedWidth: dimension,
      codedHeight: dimension,
      displayWidth: dimension,
      displayHeight: dimension,
      visibleRect: rect.optional(),
      format: z.string().max(30),
      primaries: z.string().max(40),
      transfer: z.string().max(40),
      matrix: z.string().max(40),
    })
    .optional(),
});
export type ProcessingQuality = z.infer<typeof processingQualitySchema>;
