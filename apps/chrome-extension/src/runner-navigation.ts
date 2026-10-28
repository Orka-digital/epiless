import { createNavigationLease } from './navigation-lease';
import { createNavigationRoute } from './navigation-route';
import type { NavigationServices } from './runner-navigation-services';

/** Compose focused browser operations; construction does not start capture or navigation. */
export function createRunnerNavigation(services: NavigationServices) {
  const { guard, guardedWait, content } = createNavigationLease(services);
  const { loadRoute } = createNavigationRoute(services, {
    get guard() {
      return guard;
    },
    get guardedWait() {
      return guardedWait;
    },
    get content() {
      return content;
    },
  });
  return { guard, guardedWait, content, loadRoute };
}
