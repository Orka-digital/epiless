/**
 * Own a bounded snapshot of the document and its open shadow roots.
 * Refresh invalidates selector caches; closed roots remain unobserved.
 * @returns Per-document traversal state. Getters always expose the latest snapshot;
 * consumers must not retain old arrays or mutate them.
 */
export function createContentTree() {
  // Bound work on large documents while inspecting modern open web components.
  // Closed shadow roots cannot be inspected through the standard DOM API.
  let inspectedElements: Element[] = [];
  let discoveryLimitations: string[] = [];
  const selectorCache = new Map<string, Element[]>();
  /** Rebuild the snapshot, capped at 12,000 elements and 64 open shadow roots. */
  function refreshTree() {
    inspectedElements = [];
    discoveryLimitations = [];
    selectorCache.clear();
    const walkers = [
      document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT),
    ];
    let shadowRoots = 0;
    while (walkers.length) {
      const element = walkers.at(-1)!.nextNode() as Element | null;
      if (!element) {
        walkers.pop();
        continue;
      }
      if (inspectedElements.length >= 12_000) {
        discoveryLimitations.push('DOM_DISCOVERY_LIMIT_REACHED');
        break;
      }
      inspectedElements.push(element);
      if (element.shadowRoot) {
        if (shadowRoots >= 64) {
          if (
            !discoveryLimitations.includes(
              'SHADOW_ROOT_DISCOVERY_LIMIT_REACHED',
            )
          )
            discoveryLimitations.push('SHADOW_ROOT_DISCOVERY_LIMIT_REACHED');
          continue;
        }
        shadowRoots++;
        walkers.push(
          document.createTreeWalker(
            element.shadowRoot,
            NodeFilter.SHOW_ELEMENT,
          ),
        );
      }
    }
  }
  /** Query the last snapshot and omit detached nodes; this does not refresh discovery. */
  function queryAll<T extends Element = HTMLElement>(selector: string): T[] {
    let found = selectorCache.get(selector);
    if (!found) {
      found = inspectedElements.filter((element) => element.matches(selector));
      selectorCache.set(selector, found);
    }
    return found.filter((element) => element.isConnected) as T[];
  }
  return {
    refreshTree,
    queryAll,
    get elements(): readonly Element[] {
      return inspectedElements;
    },
    get limitations(): readonly string[] {
      return discoveryLimitations;
    },
  };
}
