function composedParent(element: Element): Element | null {
  if (element.assignedSlot) return element.assignedSlot;
  const root = element.getRootNode();
  return (
    element.parentElement ?? (root instanceof ShadowRoot ? root.host : null)
  );
}
/**
 * Find a matching ancestor across slots and open shadow hosts, including the element.
 */
export function composedClosest(
  element: Element,
  selector: string,
): Element | null {
  for (
    let current: Element | null = element;
    current;
    current = composedParent(current)
  )
    if (current.matches(selector)) return current;
  return null;
}
/**
 * Test ancestry in the composed tree, including slot and shadow-host boundaries.
 */
export function composedContains(parent: Element, element: Element): boolean {
  for (
    let current: Element | null = element;
    current;
    current = composedParent(current)
  )
    if (current === parent) return true;
  return false;
}
/** Require connected positive-size geometry and visible composed ancestors; not a hit test. */
export const visible = (element: Element) => {
  const rect = element.getBoundingClientRect();
  if (!element.isConnected || rect.width <= 0 || rect.height <= 0) return false;
  for (
    let current: Element | null = element;
    current;
    current = composedParent(current)
  ) {
    const style = getComputedStyle(current);
    if (
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      style.display === 'none' ||
      Number(style.opacity) === 0
    )
      return false;
  }
  return true;
};
/**
 * Resolve aria-controls only inside the control's own document or shadow root.
 */
export function controlledElement(element: HTMLElement): HTMLElement | null {
  const root = element.getRootNode();
  return root instanceof Document || root instanceof ShadowRoot
    ? root.getElementById(element.getAttribute('aria-controls') ?? '')
    : null;
}
/**
 * Require visible geometry and an unobscured composed hit-test point before acting.
 */
export function reachable(element: HTMLElement): boolean {
  if (!visible(element)) return false;
  const rect = element.getBoundingClientRect();
  const left = Math.max(0, rect.left),
    right = Math.min(innerWidth, rect.right);
  const top = Math.max(0, rect.top),
    bottom = Math.min(innerHeight, rect.bottom);
  if (right <= left || bottom <= top) return false;
  // A covered control must never be activated by a synthetic click through a modal,
  // sticky overlay or cookie wall. Nested components require a composed hit test.
  const insetX = Math.min(4, (right - left) / 4);
  const insetY = Math.min(4, (bottom - top) / 4);
  return [
    [(left + right) / 2, (top + bottom) / 2],
    [left + insetX, top + insetY],
    [right - insetX, top + insetY],
    [left + insetX, bottom - insetY],
    [right - insetX, bottom - insetY],
  ].some(([x, y]) => {
    let hit = document.elementFromPoint(x, y);
    for (let depth = 0; hit?.shadowRoot && depth < 64; depth++) {
      const nested = hit.shadowRoot.elementFromPoint(x, y);
      if (!nested || nested === hit) break;
      hit = nested;
    }
    return Boolean(hit && composedContains(element, hit));
  });
}
/**
 * Require a visible, non-inert panel intersecting the current viewport.
 */
export function observedPanel(element: HTMLElement): boolean {
  if (
    !visible(element) ||
    composedClosest(element, '[aria-hidden="true"],[inert]')
  )
    return false;
  const rect = element.getBoundingClientRect();
  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < innerHeight &&
    rect.left < innerWidth
  );
}
