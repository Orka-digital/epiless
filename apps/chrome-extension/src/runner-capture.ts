import { createCaptureRestoration } from './capture-restoration';
import { createCaptureSourceOwner } from './capture-source-owner';
import { createCaptureViewport } from './capture-viewport';
import { createCaptureWorkspace } from './capture-workspace';
import type { CaptureServices } from './runner-capture-services';

/** Compose focused browser operations; construction does not start capture or navigation. */
export function createRunnerCapture(services: CaptureServices) {
  const {
    releasePointerOwner,
    releaseCaptureSource,
    prepareCaptureSource,
    recordUnobserved,
  } = createCaptureSourceOwner(services);
  const { resizeViewport } = createCaptureViewport(services, {
    get releaseCaptureSource() {
      return releaseCaptureSource;
    },
  });
  const { restoreEmulation, restoreWorkspace, restoreWindow } =
    createCaptureRestoration(services, {
      get releasePointerOwner() {
        return releasePointerOwner;
      },
    });
  const {
    ensureTerminalDebuggerWorkspace,
    unresolvedWorkspaceIntent,
    recordUnownedWorkspace,
  } = createCaptureWorkspace(services);
  return {
    releasePointerOwner,
    releaseCaptureSource,
    prepareCaptureSource,
    recordUnobserved,
    resizeViewport,
    restoreEmulation,
    restoreWorkspace,
    ensureTerminalDebuggerWorkspace,
    unresolvedWorkspaceIntent,
    recordUnownedWorkspace,
    restoreWindow,
  };
}
