import { expect, it } from 'vitest';
import { renderSnapshotHtml } from '../src/html';
import { exampleReport } from '../../../apps/web/src/lib/example-report';
it('exports only the supplied immutable snapshot with escaped content and no executable media', () => {
  const report = structuredClone(exampleReport);
  report.limitations.push('<script>alert("secret")</script>');
  report.routes[0]!.scenarios[0]!.findings[0]!.message =
    '<img src=x onerror=alert(1)>';
  report.routes[0]!.scenarios[0]!.findings[0]!.region = {
    x: 12,
    y: 7,
    width: 30,
    height: 20,
  };
  Object.assign(report.routes[0]!.scenarios[0]!.quality, {
    captureWindowMs: 15000,
    leadingIdleMs: 400,
    trailingIdleMs: 13000,
  });
  const html = renderSnapshotHtml(report);
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('&lt;img');
  expect(html).not.toMatch(/<(script|img|video|audio|iframe)[\s>]/i);
  expect(html).toContain("default-src 'none'");
  expect(html).toContain('NEEDS_REVIEW');
  expect(html).toContain('@media print');
  expect(html).toContain('2.00–3.00 s');
  expect(html).toContain('x 12, y 7; 30 × 20 analysepixels');
  expect(html).toContain('geen normatieve gezichtsveldmeting');
  expect(html).toContain('Meetvenster 15.00 s');
  expect(html).toContain('13.00 s zonder nieuw frame');
  expect(html).toContain('vanaf het eerste geanalyseerde frame');
});
