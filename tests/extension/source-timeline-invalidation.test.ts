import { describe, expect, it } from 'vitest';

import { sourceTimelineSchema } from '../../packages/core/src/source-timeline-schema';

import {
  copySourceTimeline,
  renderFindingDiagnostics,
  sourceRepairClues,
} from '../../packages/core/src/diagnostics';

import { type TimelineSnapshot } from '../../apps/chrome-extension/src/source-timeline-core';

import { attachSourceTimelines } from '../../apps/chrome-extension/src/collect-diagnostics';

import { exampleReport } from '../../apps/web/src/lib/example-report';

import {
  auditReportSchema,
  validatePublicReport,
} from '../../packages/core/src/report';
import {
  base,
  buffer,
  event,
  result,
  snapshot,
} from './source-timeline.fixture';
describe('temporal DOM evidence', () => {
  it('rejects cross-document, route, zoom and unsupported aspect-ratio samples rather than attributing stale geometry', () => {
    for (const mutate of [
      (s: TimelineSnapshot) => {
        s.context.documentToken = 'reloaded';
      },
      (s: TimelineSnapshot) => {
        s.context.url = 'https://example.test/changed';
      },
      (s: TimelineSnapshot) => {
        s.context.viewport.visualScale = 2;
      },
      (s: TimelineSnapshot) => {
        s.context.viewport.width = 400;
      },
      (s: TimelineSnapshot) => {
        s.context.viewport.width = 400;
        s.context.viewport.height = 300;
      },
      (s: TimelineSnapshot) => {
        s.context.viewport.dpr = 2;
      },
    ]) {
      const b = buffer();
      for (let ms = 0; ms <= 1000; ms += 100) {
        const s = snapshot(ms);
        mutate(s);
        b.add(s);
      }
      b.record(event());
      const value = b.finish(new Date(base + 1000).toISOString())[
        'candidate-1'
      ]!;
      expect(value.status).toBe('UNAVAILABLE');
      expect(value.complete).toBe(false);
      expect(value.candidates).toEqual([]);
    }
  });

  it('marks transient viewport changes incomplete even when all sampled dimensions have returned to their initial values', () => {
    const b = buffer();
    for (let ms = 0; ms <= 1000; ms += 100) {
      const s = snapshot(ms);
      // Two resize events happened between retained samples. Width, height,
      // DPR and visual viewport values now look identical to the initial ones.
      s.context.viewportRevision = ms < 500 ? 0 : 2;
      b.add(s);
    }
    b.record(event());
    const value = sourceTimelineSchema.parse(
      b.finish(new Date(base + 1000).toISOString())['candidate-1'],
    );
    expect(value.status).toBe('CORRELATED');
    expect(value.complete).toBe(false);
    expect(value.limitations).toContain(
      'VIEWPORT_CONTEXT_REVISION_CHANGED_DURING_WINDOW',
    );
    expect(value.candidates[0]!.observations).toHaveLength(5);
    expect(
      value.candidates[0]!.observations.every(
        (observation) => observation.atEpochMs < base + 500,
      ),
    ).toBe(true);
  });

  it('marks delayed callbacks and missing sampled context incomplete without synthesizing evidence', () => {
    const b = buffer();
    b.add(snapshot(0));
    b.add(snapshot(500));
    b.add(snapshot(1000));
    b.record(event());
    const value = b.finish(new Date(base + 1000).toISOString())['candidate-1']!;
    expect(value.complete).toBe(false);
    expect(value.maxSampleGapMs).toBe(500);
    expect(value.candidates[0]!.observations).toHaveLength(3);
    expect(value.limitations).toContain('DOM_TIMELINE_SAMPLE_GAP');
    const stale = buffer();
    stale.add(snapshot(5000));
    stale.record(event());
    expect(
      stale.finish(new Date(base + 5000).toISOString())['candidate-1']!.reason,
    ).toBe('NO_SAMPLES_NEAR_DETECTING_WINDOW');
  });

  it('bounds event retention and ignores stale generations and malformed frame regions', () => {
    const b = buffer();
    b.add(snapshot(500));
    expect(b.record({ ...event(), generation: 'old' })).toBe(false);
    expect(
      b.record({ ...event(), region: { x: 319, y: 0, width: 10, height: 10 } }),
    ).toBe(false);
    for (let i = 0; i < 12; i++)
      expect(b.record(event(`candidate-${i}`))).toBe(i < 8);
    expect(
      Object.keys(b.finish(new Date(base + 1000).toISOString())),
    ).toHaveLength(8);
  });

  it('deeply strips inspection authority and unknown nested fields when sharing', () => {
    const value = result();
    const token = value.candidates[0]!.inspectionToken!;
    const injected = value as unknown as Record<string, unknown>;
    injected.url = 'private-url';
    (
      value.candidates[0]!.observations[0] as unknown as Record<string, unknown>
    ).text = 'private-text';
    const copy = copySourceTimeline(value);
    const json = JSON.stringify(copy);
    expect(json).not.toContain(token);
    expect(json).not.toContain('private-');
    expect(sourceTimelineSchema.safeParse(copy).success).toBe(true);
    expect(value.candidates[0]!.inspectionToken).toBe(token);
    const report = structuredClone(exampleReport);
    report.routes[0]!.scenarios[0]!.findings[0]!.sourceTimeline = result();
    expect(auditReportSchema.safeParse(report).success).toBe(true);
    expect(() => validatePublicReport(report)).toThrow(
      'inspection capabilities',
    );
    report.routes[0]!.scenarios[0]!.findings[0]!.sourceTimeline = copy;
    expect(validatePublicReport(report)).toEqual(report);
  });

  it('provides measured repair clues and static escaped output without claiming causal proof', () => {
    const value = result();
    const clue = sourceRepairClues(value.candidates[0]!).join(' ');
    expect(clue).toContain('keyframes');
    expect(clue).toContain('3.00–4.00 s');
    const finding = structuredClone(
      exampleReport.routes[0]!.scenarios[0]!.findings[0]!,
    );
    finding.sourceTimeline = value;
    value.candidates[0]!.selectorPath = ['<script>private()</script>'];
    const html = renderFindingDiagnostics(finding);
    expect(html).toContain('geen bewezen oorzaak');
    expect(html).toContain('is onbekend');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<(script|video|img|animate)[\s>]/);
    expect(html).not.toContain(value.candidates[0]!.inspectionToken!);
  });

  it('joins only validated timeline records to matching findings', () => {
    const finding = structuredClone(
      exampleReport.routes[0]!.scenarios[0]!.findings[0]!,
    );
    attachSourceTimelines([finding], { [finding.id]: result() });
    expect(finding.sourceTimeline).toBeDefined();
    delete finding.sourceTimeline;
    const invalid = result();
    invalid.windowEndEpochMs = 0;
    attachSourceTimelines([finding], { [finding.id]: invalid });
    expect(finding.sourceTimeline).toBeUndefined();
  });
});
