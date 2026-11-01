import type { RunnerOperations } from './runner-contracts';

import type { CaptureOwner, WorkspaceOwner } from './runner-runtime';

export type CaptureServices = Pick<
  RunnerOperations,
  | 'pointerKey'
  | 'offscreen'
  | 'sleep'
  | 'guard'
  | 'errorText'
  | 'now'
  | 'content'
  | 'workspaceIntentKey'
  | 'workspaceKey'
  | 'guardedWait'
  | 'timed'
> & { capture: CaptureOwner; workspace: WorkspaceOwner };
