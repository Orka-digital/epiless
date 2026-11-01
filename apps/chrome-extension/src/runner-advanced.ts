import { createAdvancedCleanup } from './advanced-cleanup';
import { createAdvancedFinalization } from './advanced-finalization';
import { createAdvancedOwnership } from './advanced-ownership';
import { createAdvancedPreparation } from './advanced-preparation';
import type { AdvancedServices } from './runner-advanced-services';

/** Compose focused browser operations; construction does not start capture or navigation. */
export function createRunnerAdvanced(services: AdvancedServices) {
  const {
    loadAdvancedOwner,
    persistAdvancedOwner,
    closingAdvancedTabs,
    readOriginalContext,
    assertOriginalSource,
    reconcileMissingAdvancedTab,
  } = createAdvancedOwnership(services);
  const { prepareAdvancedScan, validateAdvancedStart } =
    createAdvancedPreparation(services, {
      get loadAdvancedOwner() {
        return loadAdvancedOwner;
      },
      get readOriginalContext() {
        return readOriginalContext;
      },
      get persistAdvancedOwner() {
        return persistAdvancedOwner;
      },
      get assertOriginalSource() {
        return assertOriginalSource;
      },
    });
  const { advancedClosures, closeAdvancedOwner, performAdvancedClose } =
    createAdvancedCleanup(services, {
      get closingAdvancedTabs() {
        return closingAdvancedTabs;
      },
      get loadAdvancedOwner() {
        return loadAdvancedOwner;
      },
      get assertOriginalSource() {
        return assertOriginalSource;
      },
      get persistAdvancedOwner() {
        return persistAdvancedOwner;
      },
    });
  const { showAdvancedDashboard, finalizeAdvancedJob } =
    createAdvancedFinalization(services, {
      get loadAdvancedOwner() {
        return loadAdvancedOwner;
      },
      get assertOriginalSource() {
        return assertOriginalSource;
      },
      get persistAdvancedOwner() {
        return persistAdvancedOwner;
      },
      get closeAdvancedOwner() {
        return closeAdvancedOwner;
      },
    });
  return {
    loadAdvancedOwner,
    persistAdvancedOwner,
    closingAdvancedTabs,
    readOriginalContext,
    assertOriginalSource,
    reconcileMissingAdvancedTab,
    prepareAdvancedScan,
    validateAdvancedStart,
    advancedClosures,
    closeAdvancedOwner,
    performAdvancedClose,
    showAdvancedDashboard,
    finalizeAdvancedJob,
  };
}
