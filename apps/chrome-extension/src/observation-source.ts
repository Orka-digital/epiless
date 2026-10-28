import { sameViewport } from './scenario-plan';
import {
  type CssReferenceContext,
  type DiagnosticContext,
} from './source-diagnostics';

import type { ObservationServices } from './observation-services';
/** Validate native geometry before recording; reopening a source is explicitly unobserved. */
export async function prepareObservationSource(
  services: ObservationServices,
  id: string,
  generation: string,
  taskId: string,
  scenario: string,
  initial: Awaited<ReturnType<ObservationServices['guard']>>,
) {
  let diagnosticContext: DiagnosticContext | undefined;
  // Capture geometry BEFORE any measured action/frames. Comparing it after
  // observation fails closed for scrolling, navigation, zoom or resizing.
  diagnosticContext = await services
    .content<DiagnosticContext>(
      id,
      generation,
      'FG_DIAGNOSTIC_CONTEXT',
      {},
      1_500,
    )
    .catch(() => undefined);
  await services.guard(id, generation);
  if (!diagnosticContext) throw new Error('CAPTURE_VIEWPORT_UNAVAILABLE');
  const sourceViewport = {
    width: diagnosticContext.viewport.width,
    height: diagnosticContext.viewport.height,
    dpr:
      services.capture.capturePixelRatios.get(id) ??
      diagnosticContext.viewport.dpr,
  };
  if (Math.abs(sourceViewport.dpr - diagnosticContext.viewport.dpr) >= 0.001)
    throw new Error('CAPTURE_NATIVE_DPR_CHANGED');
  const previousSource = services.capture.captureSources.get(id);
  const changedSource =
    !previousSource?.active ||
    !sameViewport(previousSource.viewport, sourceViewport);
  if (changedSource)
    await services.recordUnobserved(
      id,
      taskId,
      `${scenario}-capture-source-transition`,
      'NATIVE_CAPTURE_SOURCE_REOPENED_OUTSIDE_MEASUREMENT',
    );
  const sourceId = await services.prepareCaptureSource(
    id,
    generation,
    sourceViewport,
  );
  const zoomRevision =
    services.capture.pageZoomRevisions.get(initial.tabId) ?? 0;
  const preparedContext = await services.content<DiagnosticContext>(
    id,
    generation,
    'FG_DIAGNOSTIC_CONTEXT',
    {},
    1500,
  );
  if (
    !sameViewport(sourceViewport, preparedContext.viewport) ||
    preparedContext.documentToken !== diagnosticContext.documentToken
  )
    throw new Error('CAPTURE_VIEWPORT_CHANGED_DURING_SOURCE_START');
  diagnosticContext = preparedContext;
  const pageZoom = await chrome.tabs
    .getZoom(initial.tabId)
    .catch(() => undefined);
  const referenceContext: CssReferenceContext = {
    context: preparedContext,
    pageZoom,
    zoomRevision,
  };

  return {
    sourceId,
    sourceViewport,
    pageZoom,
    preparedContext,
    referenceContext,
    diagnosticContext,
  };
}
