import { expect, it } from 'vitest';
import { FrameAnalyzer } from '../../analysis-engine/src/index';
import { findingSchema } from '../src/report';
import {
  diagnosticSeries,
  renderFindingDiagnostics,
  transitionSummary,
  copySpatialEvidence,
  renderSpatialEvidence,
} from '../src/diagnostics';
import { exampleReport } from '../../../apps/web/src/lib/example-report';
import { spatialEvidenceSchema } from '../src/spatial';

const example = () =>
  structuredClone(exampleReport.routes[0]!.scenarios[0]!.findings[0]!);

it('renders exact simultaneous mask counts without assuming a calibrated field or excluding motion', () => {
  const spatial = spatialEvidenceSchema.parse({
    version: 1,
    coordinateSpace: 'ANALYSIS_PIXELS',
    analysisWidth: 20,
    analysisHeight: 20,
    sampledAtMs: 500,
    componentPixels: 100,
    simultaneousPixels: 200,
    simultaneousRatio: 0.5,
    maskBasis: 'QUALIFYING_TRANSITIONS_SAME_FRAME',
    pattern: { kind: 'NONE_DEMONSTRATED', automaticallyExcluded: false },
    motion: { kind: 'NONE_DEMONSTRATED', automaticallyExcluded: false },
  });
  expect(renderSpatialEvidence(spatial)).toContain('200 pixels');
  expect(renderSpatialEvidence(spatial)).toContain(
    'het frame met het grootste veldoppervlak',
  );
  expect(renderSpatialEvidence(spatial)).toContain(
    'het eerdere, eerste detectievenster',
  );
  expect(renderSpatialEvidence(spatial)).toContain(
    'Geen bruikbaar gezichtsveld of referentieveld',
  );
  expect(renderSpatialEvidence(spatial)).toContain('niet automatisch uit');
  spatial.visualField = {
    basis: 'EXPLICIT_CALIBRATION',
    reference: '<script>private()</script>',
    widthPx: 20,
    heightPx: 20,
    maximumPixels: 200,
    maximumRatio: 0.5,
    thresholdRatio: 0.25,
    exceedsThreshold: true,
    window: { x: 0, y: 0, width: 20, height: 20 },
  };
  expect(renderSpatialEvidence(spatial)).toContain('&lt;script&gt;');
  expect(renderSpatialEvidence(spatial)).toContain('overschrijdt de 25%');
  (spatial.visualField as unknown as Record<string, unknown>).privateUrl =
    'private-url';
  expect(JSON.stringify(copySpatialEvidence(spatial))).not.toContain(
    'private-url',
  );
});

it('preserves actual engine measurements through schema and static diagnostic rendering', () => {
  const analyzer = new FrameAnalyzer({ maxPixels: 1 });
  for (let i = 0; i < 50; i++) {
    const byte = Math.floor(i / 3) % 2 ? 255 : 0;
    analyzer.pushFrame({
      width: 1,
      height: 1,
      timestampMs: i * 20,
      rgba: new Uint8Array([byte, byte, byte, 255]),
    });
  }
  const result = analyzer.finish();
  expect(result.findings.length).toBeGreaterThan(0);
  const finding = findingSchema.parse(result.findings[0]);
  expect(finding.qualifyingTransitions).toBe(7);
  expect(finding.flashesInWindow).toBe(3.5);
  expect(finding.diagnostic!.samples.length).toBeGreaterThan(7);
  const html = renderFindingDiagnostics(finding);
  expect(html).toContain('Minstens 7 kwalificerende overgangen');
  expect(html).toContain('Latere waarnemingen kunnen');
  expect(html).not.toMatch(/<(img|video|audio|script|animate)[\s>]/i);
});

it('plots linear luminance separately from saturated-red eligibility', () => {
  const diagnostic = example().diagnostic!;
  diagnostic.samples = [
    { timestampMs: 0, red: 0, green: 0, blue: 0 },
    { timestampMs: 1, red: 255, green: 255, blue: 255 },
    { timestampMs: 2, red: 255, green: 0, blue: 0 },
  ];
  const series = diagnosticSeries(diagnostic);
  expect(series[0]).toEqual({ time: 0, luminance: 0, redRatio: 0 });
  expect(series[1]!.luminance).toBeCloseTo(1);
  expect(series[1]!.redRatio).toBeCloseTo(1 / 3);
  expect(series[2]!.luminance).toBeCloseTo(0.2126);
  expect(series[2]!.redRatio).toBe(1);
});

it('escapes untrusted selector/text fields and labels unavailable, incomplete and historical evidence', () => {
  const finding = example();
  delete finding.qualifyingTransitions;
  finding.flashesInWindow = 4;
  finding.source!.candidates[0]!.selectorPath = [
    '</code><img src=x onerror=alert(1)>',
  ];
  finding.diagnostic!.complete = false;
  finding.diagnostic!.omissions = [
    '<iframe src=secret>',
    '<script>secret()</script>',
  ];
  const html = renderFindingDiagnostics(findingSchema.parse(finding));
  expect(html).toContain('geen bewezen oorzaak');
  expect(html).toContain('onvolledig meetspoor');
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('&lt;img');
  expect(html).not.toMatch(/<(script|img|iframe|animate)[\s>]/i);
  expect(transitionSummary(finding)).toContain('historische telling');
  finding.source!.status = 'UNAVAILABLE';
  finding.source!.candidates = [];
  finding.source!.reason = '<script>secret()</script>';
  expect(renderFindingDiagnostics(findingSchema.parse(finding))).toContain(
    'Koppeling niet beschikbaar: &lt;script&gt;',
  );
});

it('rejects unordered samples and out-of-bounds diagnostic geometry', () => {
  const finding = example();
  finding.diagnostic!.point.x = 640;
  expect(findingSchema.safeParse(finding).success).toBe(false);
  finding.diagnostic!.point.x = 100;
  finding.diagnostic!.samples[1]!.timestampMs = 2000;
  expect(findingSchema.safeParse(finding).success).toBe(false);
});

it('rejects contradictory completeness and spatial claims in imports', () => {
  const finding = example();
  finding.diagnostic!.samples = [finding.diagnostic!.samples[0]!];
  expect(findingSchema.safeParse(finding).success).toBe(false);
  finding.diagnostic = example().diagnostic;
  finding.source!.candidates[0]!.hitCount = 10;
  expect(findingSchema.safeParse(finding).success).toBe(false);
  finding.source = example().source;
  finding.source!.candidates = [];
  expect(findingSchema.safeParse(finding).success).toBe(false);
  finding.source = example().source;
  finding.diagnostic!.windowStartMs = 1999;
  expect(findingSchema.safeParse(finding).success).toBe(false);
});

it('validates and shares only the exact two-frame inverse witness, with an explicit temporal scope', () => {
  const spatial = spatialEvidenceSchema.parse({
    version: 1,
    coordinateSpace: 'ANALYSIS_PIXELS',
    analysisWidth: 20,
    analysisHeight: 20,
    sampledAtMs: 500,
    componentPixels: 100,
    simultaneousPixels: 200,
    simultaneousRatio: 0.5,
    maskBasis: 'QUALIFYING_TRANSITIONS_SAME_FRAME',
    pattern: {
      kind: 'EXACT_BALANCED_CHECKERBOARD',
      cellWidthPx: 1,
      cellHeightPx: 1,
      automaticallyExcluded: false,
      inversePhase: {
        kind: 'EXACT_TWO_FRAME_INVERSE',
        previousSampledAtMs: 480,
        currentSampledAtMs: 500,
        comparedPixels: 100,
        firstColorPixels: 50,
        secondColorPixels: 50,
      },
    },
    motion: { kind: 'NONE_DEMONSTRATED', automaticallyExcluded: false },
  });
  expect(renderSpatialEvidence(spatial)).toContain(
    'dezelfde twee ondoorzichtige kleuren exact',
  );
  expect(renderSpatialEvidence(spatial)).toContain(
    'geen balans over de volledige flitsperiode',
  );
  expect(renderSpatialEvidence(spatial)).toContain('niet automatisch uit');
  const inverse = spatial.pattern.inversePhase!;
  (inverse as unknown as Record<string, unknown>).privateUrl = 'private-url';
  expect(JSON.stringify(copySpatialEvidence(spatial))).not.toContain(
    'private-url',
  );
  delete (inverse as unknown as Record<string, unknown>).privateUrl;
  for (const patch of [
    { currentSampledAtMs: 501 },
    { previousSampledAtMs: 500 },
    { firstColorPixels: 49, secondColorPixels: 51 },
    { comparedPixels: 200 },
  ]) {
    const invalid = structuredClone(spatial);
    Object.assign(invalid.pattern.inversePhase!, patch);
    expect(spatialEvidenceSchema.safeParse(invalid).success).toBe(false);
  }
  const invalidKind = structuredClone(spatial);
  invalidKind.pattern.kind = 'NONE_DEMONSTRATED';
  expect(spatialEvidenceSchema.safeParse(invalidKind).success).toBe(false);
  delete spatial.pattern.inversePhase;
  expect(renderSpatialEvidence(spatial)).toContain(
    'één ruimtelijk gebalanceerd frame bewijst geen temporele balans',
  );
});
