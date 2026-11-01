import { evaluateAction, normalizePublicUrl, planRoute } from '@epi-less/core';

import { composedClosest, reachable, visible } from './content-dom';

import type { ContentMessage } from './content-message';
import type { ContentSession } from './content-session';
/** Activate only a currently reachable same-origin link under the unchanged cancellation generation. */
export async function navigateContent(
  session: ContentSession,
  message: ContentMessage,
) {
  const { control, tree, policy, hasHashRoute } = session;
  const { modal } = policy;
  const { refreshTree, queryAll } = tree;

  refreshTree();
  if (tree.limitations.length)
    return { initiated: false, reason: 'NAVIGATION_DISCOVERY_INCOMPLETE' };
  const decision = planRoute({
    candidate: message.url ?? '',
    baseUrl: location.href,
    origin: location.origin,
    depth: 0,
  });
  if (
    !decision.allowed ||
    !decision.url ||
    hasHashRoute(new URL(message.url ?? '', location.href))
  )
    return { initiated: false, reason: 'NAVIGATION_OUTSIDE_POLICY' };
  const safeLink = (link: HTMLAnchorElement) =>
    visible(link) &&
    !link.download &&
    !composedClosest(link, 'form,[inert],[aria-hidden="true"]') &&
    !link.hasAttribute('aria-disabled') &&
    !link.hasAttribute('role') &&
    (!link.target || link.target === '_self') &&
    link.href === decision.url &&
    evaluateAction({
      kind: 'scroll',
      text: `${link.getAttribute('aria-label') ?? ''} ${link.textContent ?? ''}`,
    }).allowed;
  const link = queryAll<HTMLAnchorElement>('a[href]').find(safeLink);
  if (!link || modal())
    return { initiated: false, reason: 'NO_SUPPORTED_NAVIGATION_LINK' };
  control.cancelled = false;
  const generation = ++control.generation;
  link.scrollIntoView({ behavior: 'instant', block: 'center' });
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (control.cancelled || generation !== control.generation || !safeLink(link))
    return { initiated: false, reason: 'NAVIGATION_CANCELLED' };
  refreshTree();
  if (tree.limitations.length)
    return { initiated: false, reason: 'NAVIGATION_DISCOVERY_INCOMPLETE' };
  if (modal() || !reachable(link))
    return { initiated: false, reason: 'NAVIGATION_LINK_OBSCURED' };
  const from = normalizePublicUrl(location.href);
  link.click();
  return { initiated: true, from };
}
