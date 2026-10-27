export interface NavigationDriver {
  currentUrl(): Promise<string>;
  openDocument(url: string, context: 'source' | 'target'): Promise<string>;
  activateLink(url: string): Promise<string | undefined>;
  revealAndActivateLink(url: string): Promise<string | undefined>;
}

/** Preserve client-only routes after an intervening sitemap or sibling task.
 * URLs have already passed the route policy; every driver operation remains
 * bounded and validates the actual reached destination before returning it.
 */
export async function navigateDiscoveredRoute(
  target: string,
  source: string | undefined,
  driver: NavigationDriver,
): Promise<string> {
  const current = await driver.currentUrl();
  if (current !== target) {
    const reached = await driver.activateLink(target);
    if (reached !== undefined) return reached;
  }
  if (source && source !== target) {
    if (current !== source) await driver.openDocument(source, 'source');
    const reached = await driver.revealAndActivateLink(target);
    if (reached !== undefined) return reached;
    // A discovered client route may not exist on the server. A failed adapter
    // must not turn its 404 response into an allegedly reached application state.
    throw new Error('DISCOVERED_NAVIGATION_LINK_UNOBSERVED');
  }
  return driver.openDocument(target, 'target');
}
