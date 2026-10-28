/**
 * Read-only, post-observation spatial hints. A hit-tested element is NOT proof
 * that it generated a previously observed flash. No page content is collected.
 */
import {
  type DiagnosticCandidate,
  type DiagnosticRequest,
  type DiagnosticResult,
  type Rectangle,
  diagnosticContext,
} from './diagnostic-context';

import { rounded, sampleDiagnosticPoint } from './diagnostic-hit-test';
import { validateDiagnosticRequest } from './diagnostic-request';

const LIMITATIONS = [
  'POST_OBSERVATION_SPATIAL_HINT_NOT_VERIFIED_CAUSE',
  'DOM_MAY_HAVE_CHANGED_SINCE_OBSERVED_FRAMES',
  'HIT_TEST_OMITS_POINTER_EVENTS_NONE_AND_PSEUDO_ELEMENTS',
  'CLOSED_SHADOW_ROOTS_AND_IFRAME_CONTENTS_NOT_INSPECTED',
  'SPARSE_POINT_SAMPLING_MAY_MISS_SOURCES',
];

function unavailable(reason: string): DiagnosticResult {
  return {
    status: 'UNAVAILABLE',
    reason,
    coordinateSpace: 'CSS_VIEWPORT',
    sampledPoints: 0,
    candidates: [],
    limitations: [...LIMITATIONS],
  };
}

/** Map post-observation hit tests to structural hints; candidates are not verified causes. */
export function diagnosticSources(
  request: DiagnosticRequest,
): DiagnosticResult {
  const analysis = request?.analysis;
  const region = request?.region;
  const current = diagnosticContext();
  const invalid = validateDiagnosticRequest(request, current);
  if (invalid) return unavailable(invalid);
  const next = current.viewport;
  const mapped: Rectangle = {
    x: rounded((region.x / analysis.width) * next.width),
    y: rounded((region.y / analysis.height) * next.height),
    width: rounded((region.width / analysis.width) * next.width),
    height: rounded((region.height / analysis.height) * next.height),
  };
  const candidates = new Map<Element, DiagnosticCandidate>();
  const limitations = [...LIMITATIONS];
  let sampledPoints = 0;
  for (const horizontal of [1 / 6, 1 / 2, 5 / 6]) {
    for (const vertical of [1 / 6, 1 / 2, 5 / 6]) {
      const x = mapped.x + mapped.width * horizontal;
      const y = mapped.y + mapped.height * vertical;
      sampleDiagnosticPoint(x, y, candidates, limitations);
      sampledPoints++;
    }
  }
  return {
    status: candidates.size ? 'MAPPED' : 'UNAVAILABLE',
    ...(candidates.size ? {} : { reason: 'NO_INSPECTABLE_SPATIAL_TARGET' }),
    coordinateSpace: 'CSS_VIEWPORT',
    sampledPoints,
    region: mapped,
    candidates: [...candidates.values()].sort(
      (a, b) => b.hitCount - a.hitCount,
    ),
    limitations: [...new Set(limitations)],
  };
}

export {
  diagnosticContext,
  guardCssReferenceContext,
  sameCssReferenceContext,
} from './diagnostic-context';

export type {
  CssReferenceContext,
  DiagnosticContext,
  DiagnosticRequest,
  DiagnosticResult,
} from './diagnostic-context';

export {
  resolveDiagnosticPath,
  structuralDiagnosticPath,
} from './diagnostic-path';
