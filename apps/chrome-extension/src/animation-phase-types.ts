export const PHASE_ANIMATION_LIMIT = 32;

export const PHASE_WAIT_LIMIT_MS = 30_000;

export const PHASE_ALIGNMENT_LEAD_MS = 150;

/** Numeric clock rounding only; never substitutes for an unobserved interval. */
export const EPSILON_MS = 2;

export interface PhaseClock {
  documentMs: number;
  timelineMs: number;
  epochMs: number;
}

export interface AnimationPhaseState {
  clock: PhaseClock;
  currentTimeMs: number;
  startTimeMs: number;
  playbackRate: number;
  playState: 'running' | 'finished' | 'paused' | 'idle';
  durationMs: number;
  delayMs: number;
  iterations: number | null;
}

export interface AnimationPhaseRecord {
  selectorPath: string[];
  kind: 'CSS_ANIMATION' | 'CSS_TRANSITION' | 'WEB_ANIMATION';
  ordinal: number;
  origin: 'DOCUMENT' | 'TRIGGER';
  first: AnimationPhaseState;
  last: AnimationPhaseState;
}

export interface PhaseEvidence {
  version: 1;
  complete: boolean;
  reasons: string[];
  start: PhaseClock;
  end: PhaseClock;
  trigger?: { before: PhaseClock; after?: PhaseClock };
  animations: AnimationPhaseRecord[];
}

export interface PhaseReplayPlan {
  version: 1;
  status: 'REPLAYABLE' | 'UNSUPPORTED';
  reasons: string[];
  mode: 'DOCUMENT' | 'TRIGGER';
  startDocumentMs: number;
  endDocumentMs: number;
  triggerDurationMs?: number;
  animations: AnimationPhaseRecord[];
}
