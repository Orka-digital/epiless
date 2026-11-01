import type { AuditReport } from '@epi-less/core';

type Route = AuditReport['routes'][number];
type Scenario = Route['scenarios'][number];
interface VisibleScenario extends Scenario {
  scenarioIndex: number;
  firstFinding: number;
  totalFindings: number;
}
export interface VisibleRoute extends Omit<Route, 'scenarios'> {
  routeIndex: number;
  totalScenarios: number;
  scenarios: VisibleScenario[];
}

const FINDINGS_PER_SEGMENT = 10;
const SEGMENTS_PER_PAGE = 5;
const LIMITATIONS_PER_PAGE = 10;

function pageNumber(value: string | null | undefined, maximum: number): number {
  if (value == null) return 1;
  if (
    !/^[1-9]\d*$/u.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > maximum
  )
    throw new RangeError('Deze rapportpagina bestaat niet.');
  return Number(value);
}

/** Paginate after authorization. Counts always describe the entire immutable report. */
export function paginateReport(
  report: AuditReport,
  requested: { page?: string | null; notes?: string | null } = {},
) {
  const scenarioCount = report.routes.reduce(
    (sum, route) => sum + route.scenarios.length,
    0,
  );
  const findingCount = report.routes.reduce(
    (sum, route) =>
      sum +
      route.scenarios.reduce((n, scenario) => n + scenario.findings.length, 0),
    0,
  );
  const large =
    report.routes.length > 10 || scenarioCount > 10 || findingCount > 50;
  const segments: { routeIndex: number; scenario?: VisibleScenario }[] = [];
  for (const [routeIndex, route] of report.routes.entries()) {
    if (!route.scenarios.length) segments.push({ routeIndex });
    for (const [scenarioIndex, scenario] of route.scenarios.entries()) {
      const size = large
        ? FINDINGS_PER_SEGMENT
        : Math.max(1, scenario.findings.length);
      for (
        let offset = 0;
        offset < Math.max(1, scenario.findings.length);
        offset += size
      ) {
        segments.push({
          routeIndex,
          scenario: {
            ...scenario,
            findings: scenario.findings.slice(offset, offset + size),
            scenarioIndex,
            firstFinding: offset,
            totalFindings: scenario.findings.length,
          },
        });
      }
    }
  }
  const pageSize = large ? SEGMENTS_PER_PAGE : Math.max(1, segments.length);
  const pageCount = Math.max(1, Math.ceil(segments.length / pageSize));
  const page = pageNumber(requested.page, pageCount);
  const selected = segments.slice((page - 1) * pageSize, page * pageSize);
  const routes = new Map<number, VisibleRoute>();
  for (const segment of selected) {
    let route = routes.get(segment.routeIndex);
    if (!route) {
      const original = report.routes[segment.routeIndex];
      route = {
        ...original,
        scenarios: [],
        routeIndex: segment.routeIndex,
        totalScenarios: original.scenarios.length,
      };
      routes.set(segment.routeIndex, route);
    }
    if (segment.scenario) route.scenarios.push(segment.scenario);
  }
  const notePageCount = Math.max(
    1,
    Math.ceil(report.limitations.length / LIMITATIONS_PER_PAGE),
  );
  const notes = pageNumber(requested.notes, notePageCount);
  const firstLimitation = (notes - 1) * LIMITATIONS_PER_PAGE;
  return {
    routes: [...routes.values()],
    page,
    pageCount,
    notes,
    notePageCount,
    limitations: report.limitations.slice(
      firstLimitation,
      firstLimitation + LIMITATIONS_PER_PAGE,
    ),
    firstLimitation,
    limitationCount: report.limitations.length,
    scenarioCount,
    findingCount,
    visibleFindings: selected.reduce(
      (sum, item) => sum + (item.scenario?.findings.length || 0),
      0,
    ),
  };
}

export type ReportPagination = ReturnType<typeof paginateReport>;
