import { normalizePublicUrl } from '@epi-less/core';
import { createRunnerAdvanced } from './runner-advanced';
import { createRunnerAuthorization } from './runner-authorization';
import { createRunnerCapture } from './runner-capture';
import { createRunnerCommands } from './runner-commands';
import { registerRunnerEvents } from './runner-events';
import { createRunnerNavigation } from './runner-navigation';
import { createRunnerObservation } from './runner-observation';
import { createRunnerOffscreen } from './runner-offscreen';
import { recoverRunner } from './runner-recovery';
import { CaptureOwner, ExecutionOwner, WorkspaceOwner } from './runner-runtime';
import { createRunnerScheduler } from './runner-scheduler';

declare const __WEB_ORIGIN__: string;
const execution = new ExecutionOwner();
const capture = new CaptureOwner();
const workspace = new WorkspaceOwner();

const sleep = (duration: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, duration));
const now = () => new Date().toISOString();
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const observedUrl = (value: string | undefined, fallback: string): string => {
  try {
    return normalizePublicUrl(value ?? fallback);
  } catch {
    return fallback;
  }
};

const pointerKey = (tabId: number) => `pointer-session:${tabId}`;

const workspaceKey = (id: string) => `viewport-workspace:${id}`;
const workspaceIntentKey = (id: string) => `viewport-workspace-intent:${id}`;

const {
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
} = createRunnerCapture({
  workspace,
  capture,

  pointerKey,

  get offscreen() {
    return offscreen;
  },
  sleep,
  get guard() {
    return guard;
  },
  errorText,
  now,
  get content() {
    return content;
  },

  workspaceIntentKey,
  workspaceKey,
  get guardedWait() {
    return guardedWait;
  },

  get timed() {
    return timed;
  },
});

const { offscreen, ensureOffscreen, timed } = createRunnerOffscreen();

const {
  loadAdvancedOwner,
  persistAdvancedOwner,
  closingAdvancedTabs,
  reconcileMissingAdvancedTab,
  prepareAdvancedScan,
  validateAdvancedStart,
  closeAdvancedOwner,
  showAdvancedDashboard,
  finalizeAdvancedJob,
} = createRunnerAdvanced({
  workspace,
  execution,
  timed,
  workspaceKey,
  workspaceIntentKey,

  errorText,

  now,
  offscreen,
});

const { guard, guardedWait, content, loadRoute } = createRunnerNavigation({
  execution,
  workspace,

  sleep,
  timed,
});

const { observe, hoverControl, runReplay } = createRunnerObservation({
  capture,
  workspace,
  guard,
  now,
  content,
  observedUrl,

  recordUnobserved,
  prepareCaptureSource,

  guardedWait,
  offscreen,
  errorText,

  resizeViewport,
});

const { runJob } = createRunnerScheduler({
  workspace,
  capture,
  execution,
  guard,

  observe,
  loadRoute,
  guardedWait,
  content,
  recordUnobserved,
  runReplay,
  hoverControl,
  resizeViewport,
  errorText,

  releaseCaptureSource,
  restoreEmulation,
  restoreWindow,
  restoreWorkspace,
  recordUnownedWorkspace,
  offscreen,

  ensureTerminalDebuggerWorkspace,
  now,
  releasePointerOwner,
  finalizeAdvancedJob,
});

const { authorize } = createRunnerAuthorization({
  execution,
  workspace,
  capture,

  ensureOffscreen,
  sleep,

  pointerKey,

  offscreen,

  runJob,
  releasePointerOwner,
  errorText,
  now,
  finalizeAdvancedJob,
});

const { handle, continueStartIntent } = createRunnerCommands({
  capture,
  execution,
  get initialized() {
    return initialized;
  },
  reconcileMissingAdvancedTab,
  prepareAdvancedScan,
  loadAdvancedOwner,
  closeAdvancedOwner,

  content,

  unresolvedWorkspaceIntent,
  __WEB_ORIGIN__,
  validateAdvancedStart,
  now,
  persistAdvancedOwner,
  authorize,
  showAdvancedDashboard,
  offscreen,
  finalizeAdvancedJob,
});
const initialized = recoverRunner({
  offscreen,
  reconcileMissingAdvancedTab,
  pointerKey,
  workspaceKey,
  releasePointerOwner,
  errorText,
  sleep,
  restoreWorkspace,
  now,
  finalizeAdvancedJob,
  loadAdvancedOwner,
  persistAdvancedOwner,
  recordUnownedWorkspace,
  workspace,
});
registerRunnerEvents({
  errorText,
  now,
  offscreen,
  reconcileMissingAdvancedTab,
  pointerKey,
  initialized,
  continueStartIntent,
  handle,
  workspace,
  capture,
  closingAdvancedTabs,
  __WEB_ORIGIN__,
});
