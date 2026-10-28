import { type DisposableScanOwner } from './disposable-scan';

import type { RunnerOperations } from './runner-contracts';

import type { ExecutionOwner, WorkspaceOwner } from './runner-runtime';

import { type DiagnosticContext } from './source-diagnostics';

export type AdvancedServices = Pick<
  RunnerOperations,
  | 'timed'
  | 'workspaceKey'
  | 'workspaceIntentKey'
  | 'errorText'
  | 'now'
  | 'offscreen'
> & { execution: ExecutionOwner; workspace: WorkspaceOwner };

export type AdvancedDependencies = RunnerOperations & {
  closingAdvancedTabs: Set<number>;
  readOriginalContext: (tabId: number) => Promise<DiagnosticContext>;
  assertOriginalSource: (
    owner: DisposableScanOwner,
  ) => Promise<{ tab: chrome.tabs.Tab; window: chrome.windows.Window }>;
  performAdvancedClose: (owner: DisposableScanOwner) => Promise<boolean>;
  advancedClosures: Map<string, Promise<boolean>>;
};
