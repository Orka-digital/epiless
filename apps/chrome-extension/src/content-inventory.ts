import type { createContentControls } from './content-controls';
import { composedClosest, visible } from './content-dom';
import type { createContentTree } from './content-tree';
import type { PageInventory } from './model';
import { structuralDiagnosticPath } from './source-diagnostics';

/**
 * Discover bounded routes and controls without retaining labels or page titles.
 * @param tree - Per-document traversal snapshot, refreshed on each read.
 * @param policy - Safety and state predicates bound to that same tree.
 * @returns Inventory reader and an ID resolver for the most recent control map.
 * Element IDs stay stable while elements survive; every read replaces action membership.
 */
export function createContentInventory(
  tree: ReturnType<typeof createContentTree>,
  policy: ReturnType<typeof createContentControls>,
) {
  const { refreshTree, queryAll } = tree;
  const { controlKind, safeControl, controlState, modal } = policy;
  const hasHashRoute = (url: URL) => /^#!?\//.test(url.hash);
  type ControlKind = PageInventory['actions'][number]['kind'];
  const controlIds = new WeakMap<HTMLElement, string>();
  const controls = new Map<
    string,
    { element: HTMLElement; kind: ControlKind }
  >();
  function inventory(): PageInventory {
    controls.clear();
    refreshTree();
    const actions: PageInventory['actions'] = [];
    for (const element of queryAll(
      'button[aria-controls],[role="button"][aria-controls],[role="tab"][aria-controls],video,#onetrust-reject-all-handler,#CybotCookiebotDialogBodyButtonDecline',
    )) {
      const kind = controlKind(element);
      if (!safeControl(element, kind)) continue;
      const id = controlIds.get(element) ?? crypto.randomUUID();
      controlIds.set(element, id);
      controls.set(id, { element, kind });
      const selectorPath = structuralDiagnosticPath(element);
      actions.push({
        id,
        kind,
        label: kind,
        target: selectorPath ? { selectorPath, kind } : undefined,
        state: controlState(element, kind),
        focusable: element.tabIndex >= 0,
      });
      if (actions.length >= 25) break;
    }
    const limitations = [...tree.limitations];
    if (actions.length > 24) {
      limitations.push('CONTROL_DISCOVERY_LIMIT_REACHED');
      actions.length = 24;
    }
    if (actions.some((action) => action.kind === 'carousel'))
      limitations.push(
        'CAROUSEL_SAMPLING_LIMIT: supported controls have a bounded multi-step cycle; unvisited slide states remain untested.',
      );
    if (queryAll('iframe').length) limitations.push('IFRAME_DOM_NOT_INSPECTED');
    if (
      queryAll(
        'input[type="password"],iframe[src*="captcha"],[id*="captcha"],[class*="captcha"]',
      ).length
    )
      limitations.push('LOGIN_OR_CAPTCHA_UNOBSERVED');
    if (modal() && !actions.some((action) => action.kind === 'consent-reject'))
      limitations.push('MODAL_DIALOG_UNOBSERVED');
    const discoveredLinks = queryAll<HTMLAnchorElement>('a[href]').filter(
      (link) =>
        visible(link) &&
        !link.download &&
        !composedClosest(link, 'form,[inert],[aria-hidden="true"]'),
    );
    if (discoveredLinks.length > 1000)
      limitations.push('LINK_DISCOVERY_LIMIT_REACHED');
    const links = discoveredLinks.slice(0, 1000);
    if (links.some((link) => hasHashRoute(new URL(link.href))))
      limitations.push('HASH_ROUTER_ROUTES_UNOBSERVED');
    return {
      url: location.href,
      mediaPresent: queryAll('video').length > 0,
      title: '',
      links: links
        .filter((link) => !hasHashRoute(new URL(link.href)))
        .map((link) => link.href),
      actions,
      viewport: {
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      },
      scrollHeight: document.documentElement.scrollHeight,
      scrollY,
      limitations,
    };
  }
  return {
    read: inventory,
    resolveControl: (id: string) => controls.get(id),
  };
}
