import { z } from 'zod';

import { channel, dimension, finite } from './report-fields.js';
import { processingQualitySchema, spatialQualitySchema } from './spatial.js';

export const frameQualitySchema = z.strictObject({
  frameCount: z.number().int().nonnegative(),
  effectiveFps: finite,
  maxGapMs: finite,
  width: z.number().int().nonnegative().max(16384),
  height: z.number().int().nonnegative().max(16384),
  downsampled: z.boolean(),
  interrupted: z.boolean(),
  // Optional for older reports. Arrival-clock coverage is separate from decoded-frame cadence.
  captureWindowMs: finite.optional(),
  leadingIdleMs: finite.optional(),
  trailingIdleMs: finite.optional(),
  spatial: spatialQualitySchema.optional(),
  processing: processingQualitySchema.optional(),
});

export type FrameQuality = z.infer<typeof frameQualitySchema>;

export const pixelDiagnosticSchema = z
  .strictObject({
    version: z.literal(1),
    coordinateSpace: z.literal('ANALYSIS_PIXELS'),
    point: z.strictObject({
      x: z.number().int().nonnegative(),
      y: z.number().int().nonnegative(),
    }),
    analysisWidth: dimension,
    analysisHeight: dimension,
    sourceWidth: dimension,
    sourceHeight: dimension,
    windowStartMs: finite,
    windowEndMs: finite,
    complete: z.boolean(),
    samples: z
      .array(
        z.strictObject({
          timestampMs: finite,
          red: channel,
          green: channel,
          blue: channel,
        }),
      )
      .min(1)
      .max(96),
    omissions: z.array(z.string().min(1).max(200)).max(8).optional(),
  })
  .superRefine((value, context) => {
    if (
      value.point.x >= value.analysisWidth ||
      value.point.y >= value.analysisHeight ||
      value.windowEndMs < value.windowStartMs
    )
      context.addIssue({
        code: 'custom',
        message: 'Invalid diagnostic geometry or time window',
      });
    if (value.samples.at(-1)!.timestampMs > value.windowEndMs)
      context.addIssue({
        code: 'custom',
        message: 'Diagnostic samples exceed the detecting window',
      });
    if (
      value.complete &&
      (value.samples.length < 2 ||
        value.samples[0].timestampMs >= value.windowStartMs ||
        value.samples.at(-1)!.timestampMs !== value.windowEndMs)
    )
      context.addIssue({
        code: 'custom',
        message:
          'Complete diagnostic evidence requires the detecting window and preceding sample',
      });
    for (let i = 1; i < value.samples.length; i++)
      if (value.samples[i].timestampMs <= value.samples[i - 1].timestampMs)
        context.addIssue({
          code: 'custom',
          message: 'Diagnostic samples must be strictly ordered',
        });
  });

export type PixelDiagnostic = z.infer<typeof pixelDiagnosticSchema>;
