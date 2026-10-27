import { z } from 'zod';
import { normalizePublicUrl } from './policy.js';
import { sourceTimelineSchema } from './source-timeline-schema.js';
import {
  spatialEvidenceSchema,
  spatialQualitySchema,
  processingQualitySchema,
} from './spatial.js';

const identifier = z.string().min(1).max(128);
const timestamp = z.iso.datetime({ offset: true });
const finite = z.number().finite().nonnegative();
const url = z
  .url()
  .max(4096)
  .refine((value) => {
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, 'Expected HTTP(S) URL');

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

const dimension = z.number().int().positive().max(16384);
const channel = z.number().int().min(0).max(255);
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
        value.samples[0]!.timestampMs >= value.windowStartMs ||
        value.samples.at(-1)!.timestampMs !== value.windowEndMs)
    )
      context.addIssue({
        code: 'custom',
        message:
          'Complete diagnostic evidence requires the detecting window and preceding sample',
      });
    for (let i = 1; i < value.samples.length; i++)
      if (value.samples[i]!.timestampMs <= value.samples[i - 1]!.timestampMs)
        context.addIssue({
          code: 'custom',
          message: 'Diagnostic samples must be strictly ordered',
        });
  });
export type PixelDiagnostic = z.infer<typeof pixelDiagnosticSchema>;

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

export const findingSchema = z
  .strictObject({
    id: identifier,
    type: z.enum(['GENERAL_FLASH', 'RED_FLASH', 'ANIMATION_CONTROL']),
    severity: z.enum(['info', 'warning']),
    reviewStatus: z.literal('NEEDS_REVIEW'),
    startMs: finite,
    endMs: finite,
    flashesInWindow: finite,
    qualifyingTransitions: z.number().int().positive().optional(),
    affectedRatio: z.number().min(0).max(1),
    region: z
      .strictObject({ x: finite, y: finite, width: finite, height: finite })
      .optional(),
    message: z.string().min(1).max(2000),
    diagnostic: pixelDiagnosticSchema.optional(),
    source: sourceDiagnosticSchema.optional(),
    sourceTimeline: sourceTimelineSchema.optional(),
    spatial: spatialEvidenceSchema.optional(),
  })
  .refine((value) => value.endMs >= value.startMs, 'Finding end precedes start')
  .superRefine((value, context) => {
    const d = value.diagnostic,
      r = value.region;
    if (d && (d.windowStartMs < value.startMs || d.windowEndMs > value.endMs))
      context.addIssue({
        code: 'custom',
        message: 'Diagnostic window lies outside finding',
      });
    if (
      d &&
      r &&
      (r.x + r.width > d.analysisWidth || r.y + r.height > d.analysisHeight)
    )
      context.addIssue({
        code: 'custom',
        message: 'Finding region exceeds diagnostic geometry',
      });
  });
export type Finding = z.infer<typeof findingSchema>;

export const scenarioSchema = z
  .strictObject({
    id: identifier,
    type: z.string().min(1).max(80),
    startedAt: timestamp,
    endedAt: timestamp,
    quality: frameQualitySchema,
    findings: z.array(findingSchema).max(1000),
  })
  .refine(
    (value) => Date.parse(value.endedAt) >= Date.parse(value.startedAt),
    'Scenario end precedes start',
  );

export const auditReportSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: identifier,
    origin: url.refine(
      (value) => new URL(value).origin === value,
      'Expected canonical origin without path',
    ),
    startedAt: timestamp,
    endedAt: timestamp,
    engineVersion: identifier,
    runnerVersion: identifier,
    scannerBuildSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    status: z.enum([
      'NO_ISSUES_OBSERVED',
      'NEEDS_REVIEW',
      'INCONCLUSIVE',
      'ERROR',
    ]),
    passed: z.null(),
    job: z.strictObject({
      state: z.enum(['COMPLETED', 'PARTIAL', 'INTERRUPTED', 'ERROR']),
      stopReason: z.string().min(1).max(1000),
      maxRoutes: z.number().int().min(1).max(500),
      maxDepth: z.number().int().min(0).max(20),
      maxDurationMs: z.number().int().min(1).max(86_400_000),
      discoveredRoutes: z.number().int().nonnegative(),
      visitedRoutes: z.number().int().nonnegative(),
    }),
    routes: z
      .array(
        z.strictObject({
          url,
          status: z.enum(['OBSERVED', 'PARTIAL', 'SKIPPED', 'ERROR']),
          reason: z.string().max(2000).optional(),
          coverage: z
            .array(
              z.strictObject({
                id: identifier,
                scenario: z.string().min(1).max(80),
                outcome: z.enum(['TESTED', 'SKIPPED', 'UNREACHED']),
                viewportMethod: z.enum(['PHYSICAL', 'CDP']).optional(),
                reason: z.string().max(2000).optional(),
                viewport: z
                  .strictObject({
                    width: dimension,
                    height: dimension,
                    dpr: z.number().positive().max(16),
                  })
                  .optional(),
              }),
            )
            .max(200)
            .optional(),
          scenarios: z.array(scenarioSchema).max(100),
        }),
      )
      .max(500),
    limitations: z.array(z.string().min(1).max(2000)).max(100),
  })
  .superRefine((report, context) => {
    if (Date.parse(report.endedAt) < Date.parse(report.startedAt))
      context.addIssue({
        code: 'custom',
        message: 'Report end precedes start',
      });
    if (report.job.visitedRoutes > report.job.discoveredRoutes)
      context.addIssue({
        code: 'custom',
        message: 'Visited routes exceed discovered routes',
      });
    for (const [index, route] of report.routes.entries()) {
      if (new URL(route.url).origin !== report.origin)
        context.addIssue({
          code: 'custom',
          path: ['routes', index, 'url'],
          message: 'Route outside report origin',
        });
    }
  });
export type AuditReport = z.infer<typeof auditReportSchema>;

/** Strict public transport validation; user review is still required for sensitive path/text data. */
export function validatePublicReport(input: unknown): AuditReport {
  const report = auditReportSchema.parse(input);
  for (const route of report.routes) {
    if (route.url !== normalizePublicUrl(route.url))
      throw new TypeError(
        'Public routes must omit credentials, queries and fragments',
      );
    for (const scenario of route.scenarios)
      for (const finding of scenario.findings)
        if (
          finding.sourceTimeline?.candidates.some(
            (candidate) => candidate.inspectionToken !== undefined,
          )
        )
          throw new TypeError(
            'Public reports must omit local element inspection capabilities',
          );
  }
  return report;
}
