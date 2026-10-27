import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Finding } from '@epi-less/core';
import {
  guardCssReferenceContext,
  sameCssReferenceContext,
  type CssReferenceContext,
} from '../../apps/chrome-extension/src/source-diagnostics';

const snapshot = (): CssReferenceContext => ({
  pageZoom: 1,
  zoomRevision: 3,
  context: {
    url: 'https://example.test/route',
    documentToken: 'document-1',
    viewportRevision: 4,
    viewport: {
      width: 900,
      height: 560,
      dpr: 2,
      scrollX: 0,
      scrollY: 0,
      visualScale: 1,
      visualOffsetLeft: 0,
      visualOffsetTop: 0,
    },
  },
});
function finding(
  basis:
    'W3C_CSS_REFERENCE' | 'EXPLICIT_CALIBRATION' | 'W3C_1024_768_REFERENCE',
): Finding {
  return {
    id: basis,
    type: 'GENERAL_FLASH',
    severity: 'warning',
    reviewStatus: 'NEEDS_REVIEW',
    startMs: 100,
    endMs: 1000,
    flashesInWindow: 4,
    affectedRatio: 0.001,
    region: { x: 4, y: 4, width: 4, height: 4 },
    message: 'Temporal candidate.',
    spatial: {
      version: 1,
      coordinateSpace: 'ANALYSIS_PIXELS',
      analysisWidth: 1800,
      analysisHeight: 1120,
      sampledAtMs: 1000,
      componentPixels: 16,
      simultaneousPixels: 32,
      simultaneousRatio: 32 / (1800 * 1120),
      maskBasis: 'QUALIFYING_TRANSITIONS_SAME_FRAME',
      visualField: {
        basis,
        reference: 'Explicit test reference.',
        widthPx: 682,
        heightPx: 512,
        maximumPixels: 32,
        maximumRatio: 32 / (682 * 512),
        thresholdRatio: 0.25,
        exceedsThreshold: false,
        window: { x: 0, y: 0, width: 682, height: 512 },
      },
      pattern: { kind: 'NONE_DEMONSTRATED', automaticallyExcluded: false },
      motion: { kind: 'NONE_DEMONSTRATED', automaticallyExcluded: false },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('CSS reference context guard', () => {
  it('retains a stable reference through ordinary scrolling', () => {
    const before = snapshot();
    const after = snapshot();
    after.context!.viewport.scrollY = 500;
    const measurement = {
      findings: [finding('W3C_CSS_REFERENCE')],
      limitations: [],
    };
    const original = structuredClone(measurement);
    expect(sameCssReferenceContext(before, after)).toBe(true);
    guardCssReferenceContext(measurement, before, after);
    expect(measurement).toEqual(original);
  });

  it.each([
    [
      'transient resize',
      (s: CssReferenceContext) => s.context!.viewportRevision!++,
    ],
    ['transient page zoom', (s: CssReferenceContext) => s.zoomRevision++],
    [
      'missing resize observer',
      (s: CssReferenceContext) => delete s.context!.viewportRevision,
    ],
    ['missing zoom response', (s: CssReferenceContext) => delete s.pageZoom],
    ['missing document', (s: CssReferenceContext) => delete s.context],
    [
      'document replacement',
      (s: CssReferenceContext) => {
        s.context!.documentToken = 'document-2';
      },
    ],
    [
      'navigation',
      (s: CssReferenceContext) => {
        s.context!.url += '#changed';
      },
    ],
    [
      'different DPR',
      (s: CssReferenceContext) => {
        s.context!.viewport.dpr = 1;
      },
    ],
    [
      'different dimensions',
      (s: CssReferenceContext) => {
        s.context!.viewport.width = 600;
      },
    ],
    [
      'pinch zoom',
      (s: CssReferenceContext) => {
        s.context!.viewport.visualScale = 2;
      },
    ],
    [
      'page zoom',
      (s: CssReferenceContext) => {
        s.pageZoom = 2;
      },
    ],
  ])(
    'rejects %s without relying on matching endpoint geometry',
    (_, change) => {
      const after = snapshot();
      change(after);
      expect(sameCssReferenceContext(snapshot(), after)).toBe(false);
    },
  );

  it('removes only the CSS field, retaining candidates, exact counts and other explicit bases', () => {
    const measurement = {
      findings: [
        finding('W3C_CSS_REFERENCE'),
        finding('EXPLICIT_CALIBRATION'),
        finding('W3C_1024_768_REFERENCE'),
      ],
      limitations: ['Existing limitation.'],
    };
    const expected = structuredClone(measurement);
    delete expected.findings[0]!.spatial!.visualField;
    expected.limitations.push('CSS_REFERENCE_CONTEXT_CHANGED_OR_UNAVAILABLE');
    guardCssReferenceContext(measurement, snapshot(), snapshot(), true);
    guardCssReferenceContext(measurement, undefined, undefined);
    expect(measurement).toEqual(expected);
  });

  it('records unavailable context even for a segment without findings', () => {
    const measurement = { findings: [], limitations: [] };
    guardCssReferenceContext(measurement, snapshot(), undefined);
    expect(measurement.limitations).toEqual([
      'CSS_REFERENCE_CONTEXT_CHANGED_OR_UNAVAILABLE',
    ]);
  });
});

describe('document viewport revision observation', () => {
  function globals(withWindow = true) {
    const viewport = Object.assign(new EventTarget(), {
      scale: 1,
      offsetLeft: 0,
      offsetTop: 0,
    });
    const windowTarget = Object.assign(new EventTarget(), {
      visualViewport: viewport,
    });
    vi.stubGlobal('window', withWindow ? windowTarget : undefined);
    vi.stubGlobal('visualViewport', viewport);
    vi.stubGlobal('location', { href: 'https://example.test/route' });
    vi.stubGlobal('innerWidth', 900);
    vi.stubGlobal('innerHeight', 560);
    vi.stubGlobal('devicePixelRatio', 2);
    vi.stubGlobal('scrollX', 0);
    vi.stubGlobal('scrollY', 0);
    return { viewport, windowTarget };
  }

  it('remembers window and pinch resizing after both return to their original state', async () => {
    const { viewport, windowTarget } = globals();
    const { diagnosticContext } =
      await import('../../apps/chrome-extension/src/source-diagnostics');
    const before = diagnosticContext();
    vi.stubGlobal('innerWidth', 600);
    windowTarget.dispatchEvent(new Event('resize'));
    vi.stubGlobal('innerWidth', 900);
    windowTarget.dispatchEvent(new Event('resize'));
    viewport.scale = 2;
    viewport.dispatchEvent(new Event('resize'));
    viewport.scale = 1;
    viewport.dispatchEvent(new Event('resize'));
    const after = diagnosticContext();
    expect(after.viewport).toEqual(before.viewport);
    expect(after.documentToken).toBe(before.documentToken);
    expect(after.viewportRevision).toBe(before.viewportRevision! + 4);
    expect(
      sameCssReferenceContext(
        { ...snapshot(), context: before },
        { ...snapshot(), context: after },
      ),
    ).toBe(false);
  });

  it('does not invent observed revisions when no browser window exists', async () => {
    globals(false);
    const { diagnosticContext } =
      await import('../../apps/chrome-extension/src/source-diagnostics');
    expect(diagnosticContext().viewportRevision).toBeUndefined();
  });
});
