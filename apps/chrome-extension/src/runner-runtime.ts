import type { CaptureViewport } from './capture-quality';
import type { PageInventory } from './model';
import type { PointerSession } from './runner-types';
import type { ViewportWorkspace } from './viewport-workspace';

interface RunClock {
  id: string;
  generation: string;
  started: number;
  priorMs: number;
}
interface ActiveSegment {
  jobId: string;
  generation: string;
  segmentId: string;
  events: Promise<unknown>[];
}
interface CaptureSource {
  generation: string;
  sourceId: string;
  viewport: CaptureViewport;
  active: boolean;
}

/** One worker owns execution leases. Completion may release only the lease it acquired. */
export class ExecutionOwner {
  private run: Promise<void> | undefined;
  private authorization: symbol | undefined;
  private preparation: symbol | undefined;
  private runClock: RunClock | undefined;
  retentionCheckedAt = Date.now();
  get running() {
    return this.run;
  }
  get authorizing() {
    return this.authorization !== undefined;
  }
  get preparingAdvanced() {
    return this.preparation !== undefined;
  }
  get clock() {
    return this.runClock;
  }
  beginAuthorization() {
    if (this.authorization)
      throw new Error('CAPTURE_AUTHORIZATION_ALREADY_ACTIVE');
    const lease = (this.authorization = Symbol('authorization'));
    return () => {
      if (this.authorization === lease) this.authorization = undefined;
    };
  }
  beginPreparation() {
    if (this.preparation)
      throw new Error('ADVANCED_PREPARATION_ALREADY_ACTIVE');
    const lease = (this.preparation = Symbol('preparation'));
    return () => {
      if (this.preparation === lease) this.preparation = undefined;
    };
  }
  startClock(clock: RunClock) {
    this.runClock = clock;
  }
  clearClock(generation: string) {
    if (this.runClock?.generation === generation) this.runClock = undefined;
  }
  trackRun(start: () => Promise<void>) {
    if (this.run) throw new Error('RUNNER_ALREADY_ACTIVE');
    const owned = Promise.resolve()
      .then(start)
      .finally(() => {
        if (this.run === owned) this.run = undefined;
      });
    this.run = owned;
    // The job persists its failure; prevent a detached worker promise becoming unhandled.
    void owned.catch(() => undefined);
  }
}

/** Volatile capture data never survives a worker restart. Persisted jobs remain in the store. */
export class CaptureOwner {
  private segment: ActiveSegment | undefined;
  readonly captureSources = new Map<string, CaptureSource>();
  readonly capturePixelRatios = new Map<string, number>();
  readonly pageZoomRevisions = new Map<number, number>();
  get activeSegment() {
    return this.segment;
  }
  openSegment(segment: ActiveSegment) {
    this.segment = segment;
  }
  closeSegment(generation: string, segmentId: string) {
    if (
      this.segment?.generation === generation &&
      this.segment.segmentId === segmentId
    )
      this.segment = undefined;
  }
}

/** Browser resources retain their exact ownership record; no tab/window is guessed during recovery. */
export class WorkspaceOwner {
  readonly restoreWindows = new Map<
    string,
    { id: number; width: number; height: number; left?: number; top?: number }
  >();
  readonly pointerSessions = new Map<string, PointerSession>();
  readonly intentionalPointerDetaches = new Set<PointerSession>();
  readonly emulatedViewports = new Map<string, PageInventory['viewport']>();
  readonly viewportWorkspaces = new Map<string, ViewportWorkspace>();
}
