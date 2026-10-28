import {
  auditReportSchema,
  normalizePublicUrl,
  type AuditReport,
} from '@epi-less/core';
import { copyDiagnostics } from '@epi-less/core/diagnostics';
import type { ScanJob } from './model';

/** Build an audit snapshot from recorded observations; unobserved coverage remains explicit. */
export function buildReport(job: ScanJob): AuditReport {
  const observations = job.tasks.flatMap((task) => task.observations);
  const findings = observations.flatMap(
    (observation) => observation.measurement?.findings ?? [],
  );
  const limitations = new Set([
    ...job.limitations,
    'Experimental heuristic observation; normative WCAG conformance has not been validated. No safety or site-wide pass is issued.',
    'Only discovered same-origin routes and supported visible states are observed. Unknown routes, cross-origin frames, unsupported controls and account-dependent content may remain untested.',
    'Capture sampling, background rendering, colour management and downsampling can limit temporal or spatial detection.',
    ...observations.flatMap(
      (observation) => observation.measurement?.limitations ?? [],
    ),
  ]);
  const state = ['COMPLETED', 'PARTIAL', 'INTERRUPTED', 'ERROR'].includes(
    job.state,
  )
    ? (job.state as AuditReport['job']['state'])
    : 'INTERRUPTED';
  const hasUncertainty =
    Boolean(job.detailsExpiredAt) ||
    state !== 'COMPLETED' ||
    observations.length === 0 ||
    observations.some(
      (value) =>
        !value.achieved ||
        !value.measurement ||
        value.measurement.status === 'INCONCLUSIVE' ||
        value.measurement.quality.downsampled ||
        value.measurement.quality.interrupted,
    );
  return auditReportSchema.parse({
    schemaVersion: 1,
    id: job.id,
    origin: job.origin,
    startedAt: job.startedAt,
    endedAt: job.endedAt ?? new Date().toISOString(),
    engineVersion: job.engineVersion ?? 'legacy-unrecorded',
    runnerVersion: job.runnerVersion ?? 'legacy-unrecorded',
    ...(job.scannerBuildSha256
      ? { scannerBuildSha256: job.scannerBuildSha256 }
      : {}),
    status: hasUncertainty
      ? 'INCONCLUSIVE'
      : findings.length > 0
        ? 'NEEDS_REVIEW'
        : 'NO_ISSUES_OBSERVED',
    passed: null,
    job: {
      state,
      stopReason: job.stopReason ?? 'SNAPSHOT_WHILE_NOT_FINISHED',
      ...pickLimits(job),
      discoveredRoutes: job.tasks.length,
      visitedRoutes: job.tasks.filter((task) => task.observations.length > 0)
        .length,
    },
    routes: job.tasks.map((task) => ({
      url: normalizePublicUrl(task.url),
      status:
        task.state === 'OBSERVED'
          ? 'OBSERVED'
          : task.state === 'SKIPPED' || task.state === 'QUEUED'
            ? 'SKIPPED'
            : 'PARTIAL',
      reason:
        task.reasons.join('; ').slice(0, 2000) ||
        (task.state === 'QUEUED'
          ? 'Not reached before the scan ended.'
          : undefined),
      coverage: task.observations.slice(0, 200).map((observation) => ({
        id: observation.id,
        scenario: observation.scenario,
        outcome:
          observation.coverage ??
          (observation.achieved && observation.measurement
            ? 'TESTED'
            : 'UNREACHED'),
        ...(observation.reason
          ? { reason: observation.reason.slice(0, 2000) }
          : {}),
        ...(observation.replay
          ? {
              viewport: observation.replay.viewport,
              viewportMethod:
                observation.replay.viewportMethod ?? ('PHYSICAL' as const),
            }
          : {}),
      })),
      scenarios: task.observations
        .filter((observation) => observation.measurement)
        .slice(0, 100)
        .map((observation) => ({
          id: observation.id,
          type: observation.scenario,
          startedAt: observation.startedAt,
          endedAt: observation.endedAt,
          quality: observation.measurement!.quality,
          findings: observation
            .measurement!.findings.slice(0, 1000)
            .map((finding) => ({ ...finding, ...copyDiagnostics(finding) })),
        })),
    })),
    limitations: [...limitations]
      .map((value) => value.slice(0, 2000))
      .slice(0, 100),
  });
}
function pickLimits(job: ScanJob) {
  return {
    maxRoutes: job.limits.maxRoutes,
    maxDepth: job.limits.maxDepth,
    maxDurationMs: job.limits.maxDurationMs,
  };
}
