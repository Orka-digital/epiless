import { z } from 'zod';

import { normalizePublicUrl } from './policy.js';

import { sourceTimelineSchema } from './source-timeline-schema.js';

import {
  dimension,
  finite,
  identifier,
  timestamp,
  url,
} from './report-fields.js';
import {
  frameQualitySchema,
  pixelDiagnosticSchema,
} from './report-measurement.js';
import { sourceDiagnosticSchema } from './report-source.js';
import { spatialEvidenceSchema } from './spatial.js';

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
export {
  frameQualitySchema,
  pixelDiagnosticSchema,
} from './report-measurement.js';
export type { FrameQuality, PixelDiagnostic } from './report-measurement.js';
export { sourceDiagnosticSchema } from './report-source.js';
export type { SourceDiagnostic } from './report-source.js';
