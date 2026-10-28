import {
  diagnosticContext,
  resolveDiagnosticPath,
  structuralDiagnosticPath,
  type DiagnosticContext,
} from './source-diagnostics';

import { epoch, nativeTags } from './timeline-observation';

export const inspectable = new Map<
  string,
  { element: WeakRef<Element>; context: DiagnosticContext; expiresAt: number }
>();

/** A stale path is never enough: retain original-node identity in this isolated content world. */
function inspectableElement(token: string): Element | undefined {
  const value = typeof token === 'string' ? inspectable.get(token) : undefined;
  const context = diagnosticContext();
  const element = value?.element.deref();
  if (
    !value ||
    !element ||
    !element.isConnected ||
    value.expiresAt < epoch() ||
    value.context.documentToken !== context.documentToken ||
    value.context.url !== context.url
  )
    return;
  const selectorPath = structuralDiagnosticPath(element);
  if (!selectorPath || resolveDiagnosticPath(selectorPath) !== element) return;
  return element;
}

/** Resolve a short-lived local inspection capability; reject stale document targets. */
export function inspectSourceTimelineTarget(token: string) {
  const element = inspectableElement(token);
  if (!element)
    return {
      status: 'UNAVAILABLE' as const,
      reason: 'SOURCE_TARGET_STALE_OR_DOCUMENT_CHANGED',
    };
  const selectorPath = structuralDiagnosticPath(element)!;
  const rect = element.getBoundingClientRect();
  return {
    status: 'AVAILABLE' as const,
    selectorPath,
    tag: nativeTags.has(element.localName)
      ? element.localName
      : 'custom-element',
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    documentToken: diagnosticContext().documentToken,
  };
}

/** DevTools can call inspect(this bridge(token)) with useContentScriptContext, without page-world script injection. */
if (!Object.hasOwn(globalThis, '__flashguardInspectSource'))
  Object.defineProperty(globalThis, '__flashguardInspectSource', {
    value: inspectableElement,
    enumerable: false,
    writable: false,
    configurable: false,
  });
