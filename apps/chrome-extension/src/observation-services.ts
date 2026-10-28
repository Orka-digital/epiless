import type { RunnerOperations } from './runner-contracts';
import type { CaptureOwner, WorkspaceOwner } from './runner-runtime';

/** Capabilities for one observation; factories never begin capture on construction. */
export type ObservationServices = Pick<
  RunnerOperations,
  | 'guard'
  | 'now'
  | 'content'
  | 'observedUrl'
  | 'recordUnobserved'
  | 'prepareCaptureSource'
  | 'guardedWait'
  | 'offscreen'
  | 'errorText'
  | 'resizeViewport'
> & { capture: CaptureOwner; workspace: WorkspaceOwner };
