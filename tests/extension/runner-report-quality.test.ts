import { describe, expect, it } from 'vitest';

import { buildReport } from '../../apps/chrome-extension/src/report';
import { job } from './runner.fixture';
describe('exported audit integrity', () => {
  it('exports interrupted work without inventing a pass or a measurement', () => {
    const scan = job();
    scan.state = 'INTERRUPTED';
    scan.stopReason = 'CAPTURE_LOST';
    scan.endedAt = '2026-10-26T12:01:00Z';
    const report = buildReport(scan);
    expect(report.status).toBe('INCONCLUSIVE');
    expect(report.passed).toBeNull();
    expect(report.routes[0].status).toBe('SKIPPED');
    expect(report.routes[0].scenarios).toHaveLength(0);
    expect(report.job.visitedRoutes).toBe(0);
  });

  it('strips URL query/fragment/credentials from export while retaining scope', () => {
    const scan = job();
    scan.tasks[0].url =
      'https://secret:password@example.test/account?token=secret#private';
    const report = buildReport(scan);
    expect(report.routes[0].url).toBe('https://example.test/account');
    expect(JSON.stringify(report)).not.toContain('password');
    expect(JSON.stringify(report)).not.toContain('token=');
  });

  it('keeps reliable candidate findings distinct from normative conformance', () => {
    const scan = job();
    scan.state = 'COMPLETED';
    scan.endedAt = '2026-10-26T12:00:15Z';
    scan.tasks[0].state = 'OBSERVED';
    scan.tasks[0].observations.push({
      id: 'segment-one',
      scenario: 'initial',
      startedAt: scan.startedAt,
      endedAt: scan.endedAt,
      achieved: true,
      measurement: {
        status: 'NEEDS_REVIEW',
        passed: null,
        quality: {
          frameCount: 900,
          effectiveFps: 60,
          maxGapMs: 17,
          width: 640,
          height: 360,
          downsampled: true,
          interrupted: false,
        },
        limitations: ['Downsampled pixels.'],
        findings: [
          {
            id: 'candidate-one',
            type: 'GENERAL_FLASH',
            severity: 'warning',
            reviewStatus: 'NEEDS_REVIEW',
            startMs: 0,
            endMs: 1000,
            flashesInWindow: 4,
            affectedRatio: 0.3,
            message: 'Candidate needs review.',
          },
        ],
      },
    });
    const report = buildReport(scan);
    expect(report.status).toBe('INCONCLUSIVE');
    expect(report.passed).toBeNull();
    expect(report.routes[0].scenarios[0].findings).toHaveLength(1);
    expect(report.routes[0].scenarios[0].quality.downsampled).toBe(true);
  });
});
