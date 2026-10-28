/**
 * Read-only, post-observation spatial hints. A hit-tested element is NOT proof
 * that it generated a previously observed flash. No page content is collected.
 */
import { type DiagnosticRequest, type Rectangle } from './diagnostic-context';

/** Validate event identity and captured geometry before mapping pixels into the current document. */
export function validateDiagnosticRequest(
  request: DiagnosticRequest,
  current: import('./diagnostic-context').DiagnosticContext,
): string | undefined {
  const expected = request?.expected,
    analysis = request?.analysis,
    region = request?.region;
  if (
    !expected ||
    !expected.viewport ||
    typeof expected.url !== 'string' ||
    typeof expected.documentToken !== 'string' ||
    !analysis ||
    !region ||
    ![
      expected.viewport.width,
      expected.viewport.height,
      expected.viewport.dpr,
      expected.viewport.scrollX,
      expected.viewport.scrollY,
      expected.viewport.visualScale,
      expected.viewport.visualOffsetLeft,
      expected.viewport.visualOffsetTop,
      analysis.width,
      analysis.height,
      region.x,
      region.y,
      region.width,
      region.height,
    ].every(Number.isFinite)
  )
    return 'INVALID_DIAGNOSTIC_REQUEST';
  return (
    changedDiagnosticContext(expected, current) ??
    invalidDiagnosticGeometry(analysis, region, current.viewport)
  );
}

function changedDiagnosticContext(
  expected: import('./diagnostic-context').DiagnosticContext,
  current: import('./diagnostic-context').DiagnosticContext,
): string | undefined {
  if (
    expected.url !== current.url ||
    expected.documentToken !== current.documentToken
  )
    return 'DOCUMENT_CHANGED';
  const previous = expected.viewport;
  const next = current.viewport;
  if (
    (expected.viewportRevision !== undefined &&
      expected.viewportRevision !== current.viewportRevision) ||
    previous.width !== next.width ||
    previous.height !== next.height ||
    previous.dpr !== next.dpr ||
    previous.visualScale !== next.visualScale ||
    previous.visualOffsetLeft !== next.visualOffsetLeft ||
    previous.visualOffsetTop !== next.visualOffsetTop
  )
    return 'VIEWPORT_CHANGED';
  if (
    Math.abs(previous.scrollX - next.scrollX) > 0.5 ||
    Math.abs(previous.scrollY - next.scrollY) > 0.5
  )
    return 'SCROLL_CHANGED';
}

function invalidDiagnosticGeometry(
  analysis: DiagnosticRequest['analysis'],
  region: Rectangle,
  next: import('./diagnostic-context').DiagnosticContext['viewport'],
): string | undefined {
  if (
    next.visualScale !== 1 ||
    next.visualOffsetLeft !== 0 ||
    next.visualOffsetTop !== 0 ||
    next.width <= 0 ||
    next.height <= 0 ||
    next.dpr <= 0
  )
    return 'UNSUPPORTED_VIEWPORT_GEOMETRY';
  if (
    ![analysis.width, analysis.height].every(
      (value) => Number.isInteger(value) && value >= 1 && value <= 16384,
    ) ||
    region.x < 0 ||
    region.y < 0 ||
    region.width <= 0 ||
    region.height <= 0 ||
    region.x + region.width > analysis.width ||
    region.y + region.height > analysis.height
  )
    return 'INVALID_ANALYSIS_REGION';
  // Capture downsampling floors each dimension. Allow that one-pixel rounding,
  // but never project a differently shaped capture onto the current viewport.
  const scale = Math.min(
    analysis.width / next.width,
    analysis.height / next.height,
  );
  if (
    Math.abs(analysis.width - next.width * scale) > 1.01 ||
    Math.abs(analysis.height - next.height * scale) > 1.01
  )
    return 'CAPTURE_ASPECT_RATIO_MISMATCH';
}
