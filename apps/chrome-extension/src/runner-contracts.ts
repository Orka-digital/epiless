import { type PhaseReplayPlan } from './animation-phase';
import type { CaptureViewport } from './capture-quality';
import type { StartOptions } from './command-protocol';
import { type DisposableScanOwner } from './disposable-scan';
import { type MediaReplayPlan } from './media-replay';
import { type PageInventory, type ReplayScenario, type ScanJob } from './model';
import type { PointerSession } from './runner-types';
import type { PointerResult } from './trusted-pointer';
import { type ViewportMoveIntent } from './viewport-workspace';
/** Shared operation signatures; state capabilities are separate, explicit owners. */
export interface RunnerOperations {
  timed: <T>(promise: Promise<T>, timeout: number) => Promise<T>;
  workspaceKey: (id: string) => string;
  workspaceIntentKey: (id: string) => string;
  errorText: (error: unknown) => string;
  now: () => string;
  offscreen: (
    type: string,
    values?: Record<string, unknown>,
  ) => Promise<unknown>;
  ensureOffscreen: () => Promise<void>;
  sleep: (duration: number) => Promise<void>;
  pointerKey: (tabId: number) => string;
  runJob: (id: string, generation: string) => Promise<void>;
  releasePointerOwner: (id: string, session: PointerSession) => Promise<void>;
  finalizeAdvancedJob: (id: string, generation: string) => Promise<void>;
  guard: (id: string, generation: string) => Promise<ScanJob>;
  content: <T>(
    id: string,
    generation: string,
    type: string,
    values?: Record<string, unknown>,
    timeoutMs?: number,
  ) => Promise<T>;
  guardedWait: (
    id: string,
    generation: string,
    duration: number,
    expectedRoute?: string,
  ) => Promise<void>;
  initialized: Promise<void>;
  reconcileMissingAdvancedTab: () => Promise<void>;
  prepareAdvancedScan: (
    message: StartOptions,
    route?: string,
    allowInactiveSource?: boolean,
  ) => Promise<{ tabId: number }>;
  loadAdvancedOwner: () => Promise<DisposableScanOwner | undefined>;
  closeAdvancedOwner: (owner: DisposableScanOwner) => Promise<boolean>;
  unresolvedWorkspaceIntent: (
    id: string,
  ) => Promise<ViewportMoveIntent | undefined>;
  __WEB_ORIGIN__: string;
  validateAdvancedStart: (
    message: StartOptions,
    resume?: boolean,
  ) => Promise<DisposableScanOwner>;
  persistAdvancedOwner: (owner: DisposableScanOwner) => Promise<void>;
  authorize: (job: ScanJob) => Promise<void>;
  showAdvancedDashboard: (job: ScanJob) => Promise<void>;
  observedUrl: (value: string | undefined, fallback: string) => string;
  recordUnobserved: (
    id: string,
    taskId: string,
    scenario: string,
    reason: string,
    coverage?: 'SKIPPED' | 'UNREACHED',
  ) => Promise<void>;
  prepareCaptureSource: (
    id: string,
    generation: string,
    viewport: CaptureViewport,
  ) => Promise<string>;
  resizeViewport: (
    id: string,
    generation: string,
    expected: { width: number; height: number; dpr: number },
    method?: ReplayScenario['viewportMethod'],
  ) => Promise<PageInventory>;
  observe: (
    id: string,
    generation: string,
    taskId: string,
    scenario: string,
    duration: number,
    action?: () => Promise<{ achieved: boolean; reason?: string }>,
    navigation?: { from: string; to: string },
    recipe?: () => ReplayScenario | undefined,
    mediaReplay?: {
      plan?: MediaReplayPlan;
      prepared: boolean;
      preserveRecipe?: boolean;
    },
    phaseReplay?: PhaseReplayPlan,
  ) => Promise<boolean>;
  loadRoute: (
    id: string,
    generation: string,
    url: string,
    taskId: string,
    source?: string,
    sourceScrollY?: number,
  ) => Promise<string>;
  runReplay: (
    id: string,
    generation: string,
    taskId: string,
    target: ReplayScenario,
  ) => Promise<void>;
  hoverControl: (
    id: string,
    generation: string,
    target: import('./model').ReplayTarget,
  ) => Promise<PointerResult>;
  releaseCaptureSource: (id: string, generation: string) => Promise<void>;
  restoreEmulation: (id: string) => Promise<void>;
  restoreWindow: (id: string) => Promise<void>;
  restoreWorkspace: (id: string, releaseDebugger?: boolean) => Promise<void>;
  recordUnownedWorkspace: (id: string) => Promise<void>;
  ensureTerminalDebuggerWorkspace: (
    id: string,
    generation: string,
  ) => Promise<void>;
}
