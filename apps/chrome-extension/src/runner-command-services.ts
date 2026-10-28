import type { RunnerOperations } from './runner-contracts';
import type { CaptureOwner, ExecutionOwner } from './runner-runtime';
/** Explicit worker capabilities shared by command handlers; no construction side effects. */
export type CommandServices = Pick<
  RunnerOperations,
  | 'initialized'
  | 'reconcileMissingAdvancedTab'
  | 'prepareAdvancedScan'
  | 'loadAdvancedOwner'
  | 'closeAdvancedOwner'
  | 'content'
  | 'unresolvedWorkspaceIntent'
  | '__WEB_ORIGIN__'
  | 'validateAdvancedStart'
  | 'now'
  | 'persistAdvancedOwner'
  | 'authorize'
  | 'showAdvancedDashboard'
  | 'offscreen'
  | 'finalizeAdvancedJob'
> & { execution: ExecutionOwner; capture: CaptureOwner };
