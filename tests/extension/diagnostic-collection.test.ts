import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Finding } from '@epi-less/core';
import {
  collectSourceDiagnostics,
  SOURCE_DIAGNOSTIC_LIMIT,
} from '../../apps/chrome-extension/src/collect-diagnostics';
import type { DiagnosticContext } from '../../apps/chrome-extension/src/source-diagnostics';

const endedAt = Date.parse('2026-10-27T12:00:00.000Z');
const expected: DiagnosticContext = {
  url: 'https://example.test/private-route?private-token#private-fragment',
  documentToken: 'private-document-token',
  viewport: {
    width: 1280,
    height: 720,
    dpr: 1,
    scrollX: 0,
    scrollY: 200,
    visualScale: 1,
    visualOffsetLeft: 0,
    visualOffsetTop: 0,
  },
};
function finding(index = 0): Finding {
  return {
    id: `finding-${index}`,
    type: 'GENERAL_FLASH',
    severity: 'warning',
    reviewStatus: 'NEEDS_REVIEW',
    startMs: 1000,
    endMs: 2000,
    flashesInWindow: 4,
    affectedRatio: 0.1,
    region: { x: 10, y: 10, width: 30, height: 20 },
    message: 'Candidate requires review.',
    diagnostic: {
      version: 1,
      coordinateSpace: 'ANALYSIS_PIXELS',
      point: { x: 20, y: 20 },
      analysisWidth: 320,
      analysisHeight: 180,
      sourceWidth: 1280,
      sourceHeight: 720,
      windowStartMs: 1000,
      windowEndMs: 2000,
      complete: true,
      samples: [{ timestampMs: 1000, red: 20, green: 20, blue: 20 }],
    },
  };
}
const response = {
  status: 'MAPPED',
  coordinateSpace: 'CSS_VIEWPORT',
  sampledPoints: 9,
  region: { x: 40, y: 40, width: 120, height: 80 },
  candidates: [
    {
      selectorPath: ['*:nth-child(1) > *:nth-child(2) > *:nth-child(1)'],
      tag: 'canvas',
      rect: { x: 40, y: 40, width: 120, height: 80 },
      hitCount: 9,
      media: 'CANVAS',
      animation: { running: 1, paused: 0, finished: 0 },
    },
  ],
  limitations: ['POST_OBSERVATION_SPATIAL_HINT_NOT_VERIFIED_CAUSE'],
};
const options = () => ({
  expected,
  measurementEndedAt: endedAt,
  wallClock: () => endedAt + 125,
  guard: vi.fn(async () => undefined),
  request: vi.fn(async () => structuredClone(response)),
});

afterEach(() => vi.useRealTimers());
describe('post-observation source diagnostic collection', () => {
  it('uses each finding analysis dimensions and retains only safe context with measured delay', async () => {
    const findings = [finding(), finding(1)];
    findings[1]!.diagnostic!.analysisWidth = 160;
    findings[1]!.diagnostic!.analysisHeight = 90;
    const original = structuredClone(findings);
    const dependencies = options();
    await collectSourceDiagnostics(findings, dependencies);
    expect(
      dependencies.request.mock.calls.map((call: unknown[]) => call[0]),
    ).toEqual([
      {
        expected,
        analysis: { width: 320, height: 180 },
        region: original[0]!.region,
      },
      {
        expected,
        analysis: { width: 160, height: 90 },
        region: original[1]!.region,
      },
    ]);
    expect(findings[0]!.source).toMatchObject({
      status: 'MAPPED',
      sampledAt: '2026-10-27T12:00:00.125Z',
      delayMs: 125,
      viewport: { width: 1280, height: 720, dpr: 1, scrollX: 0, scrollY: 200 },
    });
    expect(JSON.stringify(findings)).not.toContain('private-');
    expect(findings.map(({ source: _, ...rest }) => rest)).toEqual(original);
    expect(dependencies.guard).toHaveBeenCalledTimes(4);
  });
  it('never queries DOM for navigation, interrupted observations or missing context', async () => {
    for (const reason of [
      'NAVIGATION_TRANSITION_HAS_NO_STABLE_SOURCE',
      'INTERRUPTED_OBSERVATION_HAS_NO_STABLE_SOURCE',
    ]) {
      const findings = [finding()];
      const dependencies = options();
      await collectSourceDiagnostics(findings, {
        ...dependencies,
        unavailableReason: reason,
      });
      expect(dependencies.request).not.toHaveBeenCalled();
      expect(findings[0]!.source?.reason).toBe(reason);
    }
    const findings = [finding()];
    const dependencies = options();
    await collectSourceDiagnostics(findings, {
      ...dependencies,
      expected: undefined,
    });
    expect(dependencies.request).not.toHaveBeenCalled();
    expect(findings[0]!.source?.reason).toBe('SOURCE_CONTEXT_UNAVAILABLE');
  });
  it('bounds requests and marks unqueried candidates without losing pixel evidence', async () => {
    const findings = Array.from({ length: 12 }, (_, index) => finding(index));
    const dependencies = options();
    await collectSourceDiagnostics(findings, dependencies);
    expect(dependencies.request).toHaveBeenCalledTimes(SOURCE_DIAGNOSTIC_LIMIT);
    expect(
      findings
        .slice(SOURCE_DIAGNOSTIC_LIMIT)
        .every(
          (entry) => entry.source?.reason === 'SOURCE_DIAGNOSTIC_LIMIT_REACHED',
        ),
    ).toBe(true);
    expect(
      findings.every((entry) => entry.diagnostic?.samples.length === 1),
    ).toBe(true);
  });
  it('does not issue requests after stop or retain a response received after cancellation', async () => {
    for (const stopAfterRequest of [false, true]) {
      const findings = [finding(), finding(1)];
      const dependencies = options();
      let guards = 0;
      dependencies.guard = vi.fn(async () => {
        if (!stopAfterRequest || ++guards > 1)
          throw new Error('private cancellation detail');
      });
      await collectSourceDiagnostics(findings, dependencies);
      expect(dependencies.request).toHaveBeenCalledTimes(
        stopAfterRequest ? 1 : 0,
      );
      expect(
        findings.every(
          (entry) => entry.source?.reason === 'SOURCE_DIAGNOSTIC_CANCELLED',
        ),
      ).toBe(true);
      expect(JSON.stringify(findings)).not.toContain('private');
    }
  });
  it('contains transport and schema failures using fixed private-data-free codes', async () => {
    const findings = [finding(), finding(1)];
    const dependencies = options();
    dependencies.request
      .mockRejectedValueOnce(new Error('https://private-host.test/?secret'))
      .mockResolvedValueOnce({
        ...response,
        unexpectedPrivateUrl: expected.url,
      } as typeof response);
    await collectSourceDiagnostics(findings, dependencies);
    expect(findings.map((entry) => entry.source?.reason)).toEqual([
      'SOURCE_DIAGNOSTIC_REQUEST_FAILED',
      'INVALID_SOURCE_DIAGNOSTIC_RESPONSE',
    ]);
    expect(JSON.stringify(findings)).not.toContain('private');
  });
  it('stops a sequence at the shared time budget and times out unresponsive DOM requests', async () => {
    let elapsed = 0;
    const findings = [finding(), finding(1), finding(2)];
    const dependencies = options();
    dependencies.request = vi.fn(async () => {
      elapsed += 2600;
      return structuredClone(response);
    });
    await collectSourceDiagnostics(findings, {
      ...dependencies,
      monotonicClock: () => elapsed,
    });
    expect(dependencies.request).toHaveBeenCalledTimes(2);
    expect(findings[0]!.source?.status).toBe('MAPPED');
    expect(findings[1]!.source?.reason).toBe(
      'SOURCE_DIAGNOSTIC_TIME_BUDGET_REACHED',
    );
    expect(findings[2]!.source?.reason).toBe(
      'SOURCE_DIAGNOSTIC_TIME_BUDGET_REACHED',
    );
    vi.useFakeTimers();
    const stalled = [finding()];
    const pending = collectSourceDiagnostics(stalled, {
      ...options(),
      request: () => new Promise(() => undefined),
    });
    await vi.advanceTimersByTimeAsync(2001);
    await pending;
    expect(stalled[0]!.source?.reason).toBe('SOURCE_DIAGNOSTIC_REQUEST_FAILED');
  });
  it('leaves legacy findings without pixel diagnostics untouched', async () => {
    const findings = [finding()];
    delete findings[0]!.diagnostic;
    const original = structuredClone(findings);
    const dependencies = options();
    await collectSourceDiagnostics(findings, dependencies);
    expect(findings).toEqual(original);
    expect(dependencies.request).not.toHaveBeenCalled();
  });
});
