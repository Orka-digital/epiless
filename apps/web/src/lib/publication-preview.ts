import type { AuditReport } from '@epi-less/core';
import { copyDiagnostics } from '@epi-less/core/diagnostics';
import { copyPublicQuality } from './publication-quality';

export interface RedactionOptions {
  routes: { included: boolean; path: string }[];
  findingText: boolean;
  scanNotes: boolean;
  scenarioLabels: boolean;
  diagnostics: boolean;
}

/** Nothing in a local URL or a free-text field is shared by default. */
export function defaultRedaction(report: AuditReport): RedactionOptions {
  return {
    routes: report.routes.map((_, i) => ({
      included: true,
      path: `/route-${i + 1}`,
    })),
    findingText: false,
    scanNotes: false,
    scenarioLabels: false,
    diagnostics: false,
  };
}

/** Produce the public preview path without credentials, query parameters or fragments. */
export function publicPath(path: string, origin: string): string {
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    // Reject control characters before URL normalization can silently remove them.
    // eslint-disable-next-line no-control-regex
    /[?#\\\s\u0000-\u001f]/u.test(path)
  )
    throw new Error(
      'Gebruik voor elk gedeeld pad een pad vanaf /, zonder queryparameters, fragment, spaties of backslashes.',
    );
  const url = new URL(path, origin);
  if (url.origin !== origin || url.username || url.password)
    throw new Error('Een gedeeld pad moet binnen dezelfde website blijven.');
  return url.href;
}

/** Explicit transport allowlist: never spread the raw import into a snapshot. */
export function buildPublicSnapshot(
  report: AuditReport,
  options: RedactionOptions,
): AuditReport {
  const omitted = options.routes.filter((route) => !route.included).length;
  const pathsChanged = options.routes.some(
    (route, i) =>
      route.included &&
      publicPath(route.path, report.origin) !==
        new URL(new URL(report.routes[i].url).pathname, report.origin).href,
  );
  const limitations = options.scanNotes
    ? [...report.limitations]
    : [
        'De oorspronkelijke scanredenen en beperkingen zijn voor deze snapshot geredigeerd. Raadpleeg de lokale audit voor de volledige context.',
      ];
  if (omitted)
    limitations.push(
      `${omitted} routes zijn niet opgenomen. De oorspronkelijke scanaantallen blijven zichtbaar.`,
    );
  if (pathsChanged)
    limitations.push(
      'Routepaden zijn voor deze snapshot aangepast; deze paden zijn labels en hoeven niet overeen te komen met bezoekbare pagina’s.',
    );
  // Keep the contract limit without silently discarding original limitations.
  if (limitations.length > 100)
    throw new Error(
      'Deze selectie bevat te veel beperkingen. Schakel oorspronkelijke scanredenen uit of neem alle ongewijzigde routes op.',
    );
  return {
    schemaVersion: 1,
    id: 'shared-snapshot',
    origin: report.origin,
    startedAt: report.startedAt,
    endedAt: report.endedAt,
    engineVersion: report.engineVersion,
    runnerVersion: report.runnerVersion,
    ...(report.scannerBuildSha256
      ? { scannerBuildSha256: report.scannerBuildSha256 }
      : {}),
    status: report.status,
    passed: null,
    job: {
      state: report.job.state,
      stopReason: options.scanNotes
        ? report.job.stopReason
        : 'Oorspronkelijke stopreden geredigeerd; scanstatus behouden.',
      maxRoutes: report.job.maxRoutes,
      maxDepth: report.job.maxDepth,
      maxDurationMs: report.job.maxDurationMs,
      discoveredRoutes: report.job.discoveredRoutes,
      visitedRoutes: report.job.visitedRoutes,
    },
    routes: report.routes.flatMap((route, i) => {
      const choice = options.routes[i];
      if (!choice?.included) return [];
      return [
        {
          url: publicPath(choice.path, report.origin),
          status: route.status,
          ...(route.coverage
            ? {
                coverage: route.coverage.map((entry, c) => ({
                  id: `route-${i + 1}-coverage-${c + 1}`,
                  scenario: options.scenarioLabels
                    ? entry.scenario
                    : 'planned-scenario',
                  outcome: entry.outcome,
                  ...(entry.viewportMethod
                    ? { viewportMethod: entry.viewportMethod }
                    : {}),
                  ...(entry.reason
                    ? {
                        reason: options.scanNotes
                          ? entry.reason
                          : 'Oorspronkelijke dekkingsreden geredigeerd.',
                      }
                    : {}),
                  ...(entry.viewport
                    ? {
                        viewport: {
                          width: entry.viewport.width,
                          height: entry.viewport.height,
                          dpr: entry.viewport.dpr,
                        },
                      }
                    : {}),
                })),
              }
            : {}),
          ...(route.reason
            ? {
                reason: options.scanNotes
                  ? route.reason
                  : 'Oorspronkelijke routereden geredigeerd.',
              }
            : {}),
          scenarios: route.scenarios.map((scenario, s) => ({
            id: `route-${i + 1}-scenario-${s + 1}`,
            type: options.scenarioLabels ? scenario.type : 'observed-scenario',
            startedAt: scenario.startedAt,
            endedAt: scenario.endedAt,
            quality: copyPublicQuality(scenario.quality),
            findings: scenario.findings.map((finding, f) => ({
              id: `route-${i + 1}-scenario-${s + 1}-finding-${f + 1}`,
              type: finding.type,
              severity: finding.severity,
              reviewStatus: finding.reviewStatus,
              startMs: finding.startMs,
              endMs: finding.endMs,
              flashesInWindow: finding.flashesInWindow,
              ...(finding.qualifyingTransitions !== undefined
                ? { qualifyingTransitions: finding.qualifyingTransitions }
                : {}),
              ...(options.diagnostics ? copyDiagnostics(finding) : {}),
              affectedRatio: finding.affectedRatio,
              ...(finding.region
                ? {
                    region: {
                      x: finding.region.x,
                      y: finding.region.y,
                      width: finding.region.width,
                      height: finding.region.height,
                    },
                  }
                : {}),
              message: options.findingText
                ? finding.message
                : 'Indicatieve flitskandidaat; aanvullende beoordeling nodig.',
            })),
          })),
        },
      ];
    }),
    limitations,
  };
}
