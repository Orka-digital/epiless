import type { RouteTask } from './model';

import { type PageInventory, type ReplayStep, type ScanJob } from './model';

import type { SchedulerServices } from './runner-services';

import { newExplorationState } from './scenario-plan';

export type ExplorationServices = Pick<
  SchedulerServices,
  | 'content'
  | 'observe'
  | 'hoverControl'
  | 'recordUnobserved'
  | 'loadRoute'
  | 'resizeViewport'
  | 'errorText'
  | 'workspace'
  | 'releaseCaptureSource'
  | 'restoreEmulation'
  | 'restoreWindow'
  | 'restoreWorkspace'
  | 'recordUnownedWorkspace'
>;
export type ExplorationInput = {
  id: string;
  generation: string;
  job: ScanJob;
  task: RouteTask;
  page: PageInventory;
  initialViewport: PageInventory['viewport'];
  recipeSteps: ReplayStep[];
  hasDiscoveredVideo: () => boolean;
  inventory: () => Promise<PageInventory>;
};
export type ExplorationContext = ExplorationInput & {
  replayReliable: boolean;
  actionCount: number;
  scrollSteps: number;
  loopAttempts: Set<string>;
  loopReason: string;
  coveredBottom: number;
  exploration: ReturnType<typeof newExplorationState>;
  reserveCompact: number;
  addLimit: (reason: string) => Promise<unknown>;
};
