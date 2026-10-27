import type { RunnerOperations } from './runner-contracts';
import type {
  CaptureOwner,
  ExecutionOwner,
  WorkspaceOwner,
} from './runner-runtime';
export type SchedulerServices = Pick<
  RunnerOperations,
  | 'guard'
  | 'observe'
  | 'loadRoute'
  | 'guardedWait'
  | 'content'
  | 'recordUnobserved'
  | 'runReplay'
  | 'hoverControl'
  | 'resizeViewport'
  | 'errorText'
  | 'releaseCaptureSource'
  | 'restoreEmulation'
  | 'restoreWindow'
  | 'restoreWorkspace'
  | 'recordUnownedWorkspace'
  | 'offscreen'
  | 'ensureTerminalDebuggerWorkspace'
  | 'now'
  | 'releasePointerOwner'
  | 'finalizeAdvancedJob'
> & {
  execution: ExecutionOwner;
  capture: CaptureOwner;
  workspace: WorkspaceOwner;
};
