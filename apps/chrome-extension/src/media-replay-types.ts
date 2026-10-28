export const MEDIA_REPLAY_LIMIT = 8;

/** 50ms samples cover the existing 120s observation ceiling, with bounded teardown margin. */
export const MEDIA_SAMPLE_LIMIT = 2600;

export const MEDIA_SAMPLE_INTERVAL_MS = 50;

export const MEDIA_PRESENTATION_LIMIT = 7800;

/** Browser media clocks can be rounded; this is not capture/DOM alignment proof. */
export const MEDIA_POSITION_EPSILON_MS = 2;

/** URL-free identity and playback position of one media element; times are milliseconds. */
export interface MediaState {
  selectorPath: string[];
  /** Hash of the local source locator, never a hash of decoded/file contents. */
  locatorSha256?: string;
  sourceKind: 'URL' | 'STREAM' | 'UNAVAILABLE';
  durationMs: number | null;
  timeMs: number;
  playbackRate: number;
  loop: boolean;
  paused: boolean;
  seekable: [number, number][];
}

/** One observation-time sample of the playback clock; not itself a decoded-frame witness. */
export interface MediaSample {
  atMs: number;
  timeMs: number;
  paused: boolean;
  ended: boolean;
  seeking: boolean;
  playbackRate: number;
  loop: boolean;
  presentation?: { timeMs: number; count: number; wraps: number };
}

/** One actual compositor callback, with observation-relative and media timestamps. */
export interface MediaPresentation {
  atMs: number;
  timeMs: number;
  /** Browser compositor metadata, not our own timer/callback count. */
  presentedFrames: number;
}

/** Bounded before/after, timer and compositor evidence for one observation segment. */
export interface MediaEvidence {
  version: 1;
  complete: boolean;
  startedEpochMs?: number;
  endedEpochMs?: number;
  reasons: string[];
  items: {
    before: MediaState;
    after: MediaState;
    samples: MediaSample[];
    presentations?: MediaPresentation[];
  }[];
}

/** Saved playback preconditions and genuinely reached endpoints for a targeted replay. */
export interface MediaReplayPlan {
  version: 1;
  status: 'REPLAYABLE' | 'UNSUPPORTED';
  reasons: string[];
  items: MediaState[];
  /** Actual original interval endpoints, used only to extend a replay by <=500ms. */
  coverage?: {
    endMs: number;
    wraps: number;
    presentedEndMs?: number;
    presentedWraps?: number;
  }[];
}
