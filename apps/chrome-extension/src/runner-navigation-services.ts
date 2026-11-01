import type { RunnerOperations } from './runner-contracts';

import type { ExecutionOwner, WorkspaceOwner } from './runner-runtime';

export type NavigationServices = Pick<RunnerOperations, 'sleep' | 'timed'> & {
  execution: ExecutionOwner;
  workspace: WorkspaceOwner;
};
