import { z } from 'zod';

import { dimension, finite, timestamp } from './report-fields.js';

const cssRect = z.strictObject({
  x: z.number().finite().min(-1_000_000).max(1_000_000),
  y: z.number().finite().min(-1_000_000).max(1_000_000),
  width: finite.max(1_000_000),
  height: finite.max(1_000_000),
});

export const sourceDiagnosticSchema = z
  .strictObject({
    status: z.enum(['MAPPED', 'UNAVAILABLE']),
    reason: z.string().max(200).optional(),
    coordinateSpace: z.literal('CSS_VIEWPORT'),
    sampledAt: timestamp,
    delayMs: finite,
    viewport: z
      .strictObject({
        width: dimension,
        height: dimension,
        dpr: z.number().positive().max(16),
        scrollX: z.number().finite(),
        scrollY: z.number().finite(),
      })
      .optional(),
    sampledPoints: z.number().int().min(0).max(9),
    region: cssRect.optional(),
    candidates: z
      .array(
        z.strictObject({
          selectorPath: z.array(z.string().min(1).max(512)).min(1).max(8),
          tag: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/),
          rect: cssRect,
          hitCount: z.number().int().min(1).max(9),
          media: z.enum(['VIDEO', 'CANVAS', 'IMAGE', 'IFRAME']).optional(),
          animation: z.strictObject({
            running: z.number().int().nonnegative(),
            paused: z.number().int().nonnegative(),
            finished: z.number().int().nonnegative(),
          }),
        }),
      )
      .max(6),
    limitations: z.array(z.string().min(1).max(300)).max(8),
  })
  .superRefine((value, context) => {
    if (
      value.status === 'MAPPED' &&
      (!value.candidates.length || !value.sampledPoints || !value.region)
    )
      context.addIssue({
        code: 'custom',
        message:
          'Mapped source evidence requires sampled candidates and a region',
      });
    if (value.status === 'UNAVAILABLE' && value.candidates.length)
      context.addIssue({
        code: 'custom',
        message: 'Unavailable source evidence cannot claim candidates',
      });
    if (
      value.candidates.some(
        (candidate) => candidate.hitCount > value.sampledPoints,
      )
    )
      context.addIssue({
        code: 'custom',
        message: 'Candidate hits exceed sampled points',
      });
  });

export type SourceDiagnostic = z.infer<typeof sourceDiagnosticSchema>;
