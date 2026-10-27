import type { historySummary } from './history';
import { type HistorySettings, type ScanJob, type ScanMode } from './model';
import type { PendingRecheck } from './store';
export interface AppState {
  jobs: ScanJob[];
  tab: { id?: number; url?: string };
  webOrigin: string;
  settings: HistorySettings;
  sites: ReturnType<typeof historySummary>;
  preferences: { mode: ScanMode; viewportSeconds: number };
  recheck?: PendingRecheck;
  advancedPreparation?: {
    tabId: number;
    originalTabId: number;
    mode: ScanMode;
    viewportSeconds: number;
  };
  advancedRecovery?: { tabId?: number; reason: string };
  workspaceRecovery?: Array<{
    jobId: string;
    tabId: number;
    originalWindowId: number;
    originalIndex: number;
  }>;
}
