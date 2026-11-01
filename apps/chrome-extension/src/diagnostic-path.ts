/**
 * Read-only, post-observation spatial hints. A hit-tested element is NOT proof
 * that it generated a previously observed flash. No page content is collected.
 */

/** Positional child paths never expose IDs, classes, custom tag names or text. */
export function structuralDiagnosticPath(
  element: Element,
): string[] | undefined {
  const roots: string[] = [];
  let current: Element | null = element;
  let segments: string[] = [];
  let depth = 0;
  let siblingsVisited = 0;
  while (current) {
    if (++depth > 32) return;
    let position = 1;
    for (
      let sibling = current.previousElementSibling;
      sibling;
      sibling = sibling.previousElementSibling
    ) {
      if (++siblingsVisited > 2048) return;
      position++;
    }
    segments.unshift(`*:nth-child(${position})`);
    if (current.parentElement) {
      current = current.parentElement;
      continue;
    }
    const selector = segments.join(' > ');
    if (selector.length > 512) return;
    roots.unshift(selector);
    segments = [];
    const root = current.getRootNode();
    if (root instanceof ShadowRoot) {
      if (roots.length >= 8 || root.mode !== 'open') return;
      current = root.host;
    } else {
      if (root !== document) return;
      current = null;
    }
  }
  return roots;
}

/**
 * Resolve only direct children at every step, starting at the provided root.
 * Passing these strings to querySelector is unsafe: an unanchored selector in a
 * shadow root may match a nested sibling before the intended root child.
 */
export function resolveDiagnosticPath(
  path: string[],
  initialRoot: Document | ShadowRoot = document,
): Element | undefined {
  if (!Array.isArray(path) || path.length < 1 || path.length > 8) return;
  let root: Document | ShadowRoot | Element = initialRoot;
  let target: Element | undefined;
  let depth = 0;
  for (const [rootIndex, positionPath] of path.entries()) {
    if (typeof positionPath !== 'string' || positionPath.length > 512) return;
    const steps = positionPath.split(' > ');
    for (const step of steps) {
      if (++depth > 32) return;
      const match = /^\*:nth-child\(([1-9]\d{0,3})\)$/.exec(step);
      const position = match ? Number(match[1]) : 0;
      if (position < 1 || position > 2049) return;
      target = root.children.item(position - 1) ?? undefined;
      if (!target) return;
      root = target;
    }
    if (rootIndex < path.length - 1) {
      if (!target?.shadowRoot || target.shadowRoot.mode !== 'open') return;
      root = target.shadowRoot;
    }
  }
  return target;
}
