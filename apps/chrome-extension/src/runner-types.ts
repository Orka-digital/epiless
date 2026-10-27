import type { DebuggerViewportBaseline } from './viewport-workspace';

/** Ownership of a debugger attachment, including the pre-attach viewport. */
export interface PointerSession {
  tabId: number;
  generation: string;
  restore?: DebuggerViewportBaseline;
}
export type StoredPointerSession = PointerSession & { jobId: string };
