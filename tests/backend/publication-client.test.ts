import { describe, expect, it } from 'vitest';
import { validatePublicReport } from '../../packages/core/src/report';
import { exampleReport } from '../../apps/web/src/lib/example-report';
import {
  buildPublicSnapshot,
  defaultRedaction,
  publicPath,
} from '../../apps/web/src/lib/publication-preview';
import { retryDelay } from '../../apps/web/src/lib/upload-queue';

describe('explicit publication transport preview', () => {
  it('preserves numerical processing evidence and unreached coverage while stripping nested private metadata', () => {
    const report = structuredClone(exampleReport);
    report.scannerBuildSha256 = 'a'.repeat(64);
    report.routes[0]!.coverage = [
      {
        id: 'private-coverage-id',
        scenario: 'private-control-name',
        viewportMethod: 'CDP',
        outcome: 'UNREACHED',
        reason: 'private-failure-detail',
        viewport: { width: 600, height: 400, dpr: 2 },
      },
    ];
    const quality = report.routes[0]!.scenarios[0]!.quality;
    quality.processing = {
      measuredFrames: 60,
      meanMs: 12,
      maxMs: 25,
      framesOver16_7Ms: 2,
      scope: 'WORKER_CONVERSION_AND_ANALYSIS',
      conversionMeanMs: 7,
      analysisMeanMs: 5,
      conversionMethods: ['VIDEOFRAME_COPY_RGBA'],
      track: { width: 1200, height: 800, frameRate: 60, resizeMode: 'none' },
      decoded: {
        codedWidth: 1200,
        codedHeight: 800,
        displayWidth: 1200,
        displayHeight: 800,
        format: 'I420',
        primaries: 'bt709',
        transfer: 'bt709',
        matrix: 'bt709',
        visibleRect: { x: 0, y: 0, width: 1200, height: 800 },
      },
    };
    const numerical = structuredClone(quality.processing);
    Object.assign(quality.processing.track!, { deviceId: 'private-device' });
    Object.assign(quality.processing.decoded!, { rawFrame: 'private-pixels' });
    Object.assign(quality.processing.decoded!.visibleRect!, {
      url: 'private-url',
    });
    Object.assign(report.routes[0]!.coverage![0]!.viewport!, {
      selector: 'private-selector',
    });
    const publicReport = buildPublicSnapshot(report, defaultRedaction(report));
    expect(publicReport.scannerBuildSha256).toBe(report.scannerBuildSha256);
    expect(publicReport.routes[0]!.scenarios[0]!.quality.processing).toEqual(
      numerical,
    );
    expect(publicReport.routes[0]!.coverage![0]).toMatchObject({
      outcome: 'UNREACHED',
      viewportMethod: 'CDP',
      viewport: { width: 600, height: 400, dpr: 2 },
    });
    expect(JSON.stringify(publicReport)).not.toContain('private-');
    expect(validatePublicReport(publicReport)).toEqual(publicReport);
    expect(
      publicReport.routes[0]!.scenarios[0]!.quality.processing!.decoded,
    ).not.toBe(quality.processing.decoded);
  });
  it('omits technical traces and source hints by default and allowlists an explicit opt-in deeply', () => {
    const report = structuredClone(exampleReport);
    const finding = report.routes[0]!.scenarios[0]!.findings[0]!;
    const choice = defaultRedaction(report);
    expect(choice.diagnostics).toBe(false);
    const hidden = buildPublicSnapshot(report, choice).routes[0]!.scenarios[0]!
      .findings[0]!;
    expect(hidden.diagnostic).toBeUndefined();
    expect(hidden.source).toBeUndefined();
    expect(hidden.qualifyingTransitions).toBe(7);
    Object.assign(finding.diagnostic!, { screenshot: 'private-capture' });
    Object.assign(finding.diagnostic!.samples[0]!, {
      cookie: 'private-cookie',
    });
    Object.assign(finding.source!, {
      url: 'private-url',
      documentToken: 'private-token',
    });
    Object.assign(finding.source!.candidates[0]!, { text: 'private-text' });
    Object.assign(finding.source!.candidates[0]!.rect, {
      secret: 'private-region',
    });
    choice.diagnostics = true;
    const shared = buildPublicSnapshot(report, choice);
    expect(JSON.stringify(shared)).not.toContain('private-');
    expect(validatePublicReport(shared)).toEqual(shared);
    const copied = shared.routes[0]!.scenarios[0]!.findings[0]!;
    expect(copied.diagnostic!.samples).toHaveLength(8);
    expect(copied.source!.candidates[0]!.tag).toBe('canvas');
    expect(copied.diagnostic!.samples).not.toBe(finding.diagnostic!.samples);
  });

  it('keeps capture silence evidence through redaction without changing actual frame cadence', () => {
    const report = structuredClone(exampleReport);
    const quality = report.routes[0]!.scenarios[0]!.quality;
    Object.assign(quality, {
      captureWindowMs: 15000,
      leadingIdleMs: 400,
      trailingIdleMs: 13000,
      interrupted: true,
    });
    const snapshot = buildPublicSnapshot(report, defaultRedaction(report));
    expect(snapshot.routes[0]!.scenarios[0]!.quality).toEqual(quality);
    expect(validatePublicReport(snapshot)).toEqual(snapshot);
  });

  it('excludes sensitive paths, every optional text field and local identifiers by default', () => {
    const report = structuredClone(exampleReport);
    report.id = 'secret-customer-id';
    report.job.stopReason = 'secret-customer-stop';
    report.routes[0]!.url =
      'https://example.org/secret-customer?token=secret#secret';
    report.routes[0]!.reason = 'secret-customer-reason';
    const scenario = report.routes[0]!.scenarios[0]!;
    scenario.id = 'secret-customer-scenario-id';
    scenario.type = 'secret-customer-label';
    scenario.findings[0]!.id = 'secret-customer-finding-id';
    scenario.findings[0]!.message = 'secret-customer-finding-text';
    report.limitations = ['secret-customer-limitation'];
    // Unknown local-only fields cannot leak even if an upstream importer changes.
    Object.assign(report, { screenshot: 'secret-screenshot' });
    Object.assign(scenario.quality, { cookie: 'secret-cookie' });
    const snapshot = buildPublicSnapshot(report, defaultRedaction(report));
    expect(JSON.stringify(snapshot)).not.toContain('secret');
    expect(snapshot.routes[0]!.url).toBe('https://example.org/route-1');
    expect(snapshot.job.state).toBe(report.job.state);
    expect(snapshot.routes[0]!.scenarios[0]!.quality).toEqual(
      exampleReport.routes[0]!.scenarios[0]!.quality,
    );
    expect(snapshot.limitations.join(' ')).toContain('geredigeerd');
    expect(snapshot.passed).toBeNull();
    expect(validatePublicReport(snapshot)).toEqual(snapshot);
  });

  it('includes only explicitly chosen text and paths and documents missing coverage', () => {
    const report = structuredClone(exampleReport);
    report.routes.push({
      url: `${report.origin}/private`,
      status: 'SKIPPED',
      reason: 'Private route',
      scenarios: [],
    });
    const choice = defaultRedaction(report);
    choice.routes[0]!.path = '/reviewed';
    choice.routes[1]!.included = false;
    choice.findingText = true;
    choice.scenarioLabels = true;
    const snapshot = buildPublicSnapshot(report, choice);
    expect(snapshot.routes).toHaveLength(1);
    expect(snapshot.routes[0]!.scenarios[0]!.findings[0]!.message).toBe(
      report.routes[0]!.scenarios[0]!.findings[0]!.message,
    );
    expect(snapshot.routes[0]!.scenarios[0]!.type).toBe('initial-load');
    expect(snapshot.limitations).toContain(
      '1 routes zijn niet opgenomen. De oorspronkelijke scanaantallen blijven zichtbaar.',
    );
    expect(JSON.stringify(snapshot)).not.toContain('/private');
    choice.scanNotes = true;
    expect(buildPublicSnapshot(report, choice).limitations).toContain(
      report.limitations[0],
    );
  });

  it.each([
    'https://other.test/',
    '//other.test',
    '/account?token=x',
    '/account#private',
    '/\\other.test',
    '/a\nb',
    'relative',
  ])('rejects unsafe edited path %s', (path) => {
    expect(() => publicPath(path, 'https://example.org')).toThrow();
  });

  it('does not silently truncate the original limitations to fit redaction notices', () => {
    const report = structuredClone(exampleReport);
    report.limitations = Array.from(
      { length: 100 },
      (_, i) => `Limitation ${i}`,
    );
    const choice = defaultRedaction(report);
    choice.scanNotes = true;
    expect(() => buildPublicSnapshot(report, choice)).toThrow(
      'te veel beperkingen',
    );
  });
});

it('bounds exponential backoff and respects a longer server Retry-After', () => {
  expect(retryDelay(1)).toBe(5_000);
  expect(retryDelay(2)).toBe(10_000);
  expect(retryDelay(100)).toBe(300_000);
  expect(retryDelay(1, 60_000)).toBe(60_000);
  expect(retryDelay(3, 86_400_000)).toBe(86_400_000);
});
