import { describe, expect, it } from 'vitest';
import { exampleReport } from '../../apps/web/src/lib/example-report';
import { paginateReport } from '../../apps/web/src/lib/report-pagination';

describe('bounded report rendering without discarding findings', () => {
  it('preserves the small report experience and full report counts', () => {
    const result = paginateReport(exampleReport);
    expect(result.pageCount).toBe(1);
    expect(result.notePageCount).toBe(1);
    expect(result.routes[0]!.scenarios[0]!.findings).toEqual(
      exampleReport.routes[0]!.scenarios[0]!.findings,
    );
    expect(result.limitations).toEqual(exampleReport.limitations);
  });

  it('bounds a huge single scenario and preserves every finding exactly once', () => {
    const report = structuredClone(exampleReport);
    const scenario = report.routes[0]!.scenarios[0]!;
    scenario.findings = Array.from({ length: 231 }, (_, i) => ({
      ...scenario.findings[0]!,
      id: `finding-${i}`,
    }));
    const first = paginateReport(report);
    expect(first.pageCount).toBe(5);
    const findings: string[] = [];
    for (let page = 1; page <= first.pageCount; page++) {
      const view = paginateReport(report, { page: String(page) });
      expect(view.visibleFindings).toBeLessThanOrEqual(50);
      expect(view.findingCount).toBe(231);
      expect(view.scenarioCount).toBe(1);
      for (const route of view.routes)
        for (const part of route.scenarios) {
          expect(part.totalFindings).toBe(231);
          findings.push(...part.findings.map((finding) => finding.id));
        }
    }
    expect(findings).toEqual(scenario.findings.map((finding) => finding.id));
    expect(report.routes[0]!.scenarios[0]!.findings).toHaveLength(231);
  });

  it('bounds many empty scenarios and routes without losing skipped-route coverage', () => {
    const report = structuredClone(exampleReport);
    const template = report.routes[0]!.scenarios[0]!;
    report.routes[0]!.scenarios = Array.from({ length: 100 }, (_, i) => ({
      ...template,
      id: `scenario-${i}`,
      findings: [],
    }));
    for (let i = 0; i < 25; i++)
      report.routes.push({
        url: `${report.origin}/skipped-${i}`,
        status: 'SKIPPED',
        scenarios: [],
      });
    const first = paginateReport(report);
    expect(first.pageCount).toBe(25);
    const scenarios: string[] = [],
      emptyRoutes: string[] = [];
    for (let page = 1; page <= first.pageCount; page++) {
      const view = paginateReport(report, { page: String(page) });
      expect(
        view.routes.reduce(
          (sum, route) => sum + Math.max(1, route.scenarios.length),
          0,
        ),
      ).toBeLessThanOrEqual(5);
      for (const route of view.routes) {
        scenarios.push(...route.scenarios.map((scenario) => scenario.id));
        if (!route.scenarios.length) emptyRoutes.push(route.url);
      }
    }
    expect(scenarios).toHaveLength(100);
    expect(new Set(scenarios).size).toBe(100);
    expect(emptyRoutes).toEqual(
      report.routes.slice(1).map((route) => route.url),
    );
  });

  it('paginates limitations independently and retains every original note', () => {
    const report = structuredClone(exampleReport);
    report.limitations = Array.from(
      { length: 25 },
      (_, i) => `Limitation ${i}`,
    );
    const first = paginateReport(report);
    expect(first.pageCount).toBe(1);
    expect(first.notePageCount).toBe(3);
    const notes = Array.from(
      { length: 3 },
      (_, i) => paginateReport(report, { notes: String(i + 1) }).limitations,
    ).flat();
    expect(notes).toEqual(report.limitations);
  });

  it.each(['0', '-1', '1.5', '01', 'abc', '999999', '2'])(
    'rejects nonexistent detail page %s',
    (page) => {
      expect(() => paginateReport(exampleReport, { page })).toThrow(RangeError);
      expect(() => paginateReport(exampleReport, { notes: page })).toThrow(
        RangeError,
      );
    },
  );
});
