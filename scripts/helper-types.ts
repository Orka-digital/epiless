/** Contracts for pinned numeric fixtures and helper I/O; runtime validators remain authoritative. */
export interface SourceFile {
  path: string;
  sourceUrl: string;
  gitBlobSha1: string;
  sha256: string;
}
type TemporalSource = SourceFile &
  (
    | { kind: 'provenance' }
    | {
        kind: 'GENERAL_FLASH' | 'RED_FLASH';
        framesPerSecond: number;
        expectedCandidate: boolean;
      }
  );
export interface TemporalManifest {
  schemaVersion: number;
  upstreamRepository: string;
  upstreamCommit: string;
  license: string;
  files: TemporalSource[];
}
type ComboSource = SourceFile & { size: number } & (
    | { kind: 'PROVENANCE' }
    | {
        kind: 'COMBINED_GENERAL_RED';
        framesPerSecond: number;
        expectedChannels: Record<string, boolean>;
      }
  );
export interface ComboManifest extends Omit<TemporalManifest, 'files'> {
  files: ComboSource[];
  selectedBeforeEvaluationAt: string;
  independentInputs: number;
  channelChecks: number;
  frozenEngine: {
    typescriptTreeSha256: string;
    kernelSourceSha256: string;
    kernelBinarySha256: string;
    kernelManifestSha256: string;
  };
}
interface ReferenceIdentity {
  [key: string]: string | number;
  repository: string;
  commit: string;
  manifestSha256: string;
}
interface TemporalCase {
  id: string;
  kind: string;
  expectedCandidate: boolean;
  observedCandidate: boolean;
}
export interface TemporalReport {
  scope: string;
  cases: TemporalCase[];
  reference: ReferenceIdentity;
  engineVersion: string;
  engineSourceSha256: string;
  sourceCases?: number;
  unscored?: unknown[];
}
export interface VideoConfig {
  framerate: number;
  colormodel: string;
  bgcolor: string;
  pattern: { spatial: string; temporal_color: string }[];
  expected_result: { wcag2_2: string };
  events?: AlternatingVideo['eventAnnotations'];
  failure_details?: AlternatingVideo['failureDetails'];
}
interface AlternatingVideo {
  path: string;
  dependencies: { spatial: string; temporal_color: string };
  expectedWcagClassic: string;
  upstreamCsvPass: string;
  upstreamCsvDimension: string;
  eventAnnotations: Record<
    string,
    { type: string; firstFrame: number; lastFrame: number }
  > | null;
  failureDetails: Record<string, unknown> | null;
}
export interface AlternatingManifest {
  schemaVersion: number;
  repository: string;
  commit: string;
  frozenEngineTreeSha256: string;
  files: (SourceFile & {
    bytes: number;
    overlapWithPriorCorpora: {
      manifest: string;
      path: string;
      match: string;
    }[];
  })[];
  videos: AlternatingVideo[];
  frozenBeforeScoringAt: string;
  counts: Record<string, number>;
  priorManifests: { path: string; sha256: string }[];
}
export interface SpatialManifest {
  schemaVersion: number;
  repository: string;
  commit: string;
  files: SourceFile[];
  masks: { path: string; expectedAboveThreshold: boolean }[];
  videos: {
    path: string;
    expectedWcagClassic: string;
    csvExpected?: boolean;
    csvLabelPath?: string;
  }[];
}
export interface VideoProbe {
  streams?: {
    codec_name: string;
    width: number;
    height: number;
    r_frame_rate: string;
  }[];
  frames?: { best_effort_timestamp_time: string }[];
}
export interface RoundTripOptions {
  mask: Uint8Array;
  background: number[];
  samples: Uint8Array[];
  frameRate: number;
  mediaPath: string;
  expectedHashes: string[];
  expectedTimes: number[];
  onFrame: (rgba: Buffer, timestampMs: number) => void | Promise<void>;
}
export interface DatabaseArchive {
  kind: string;
  schemaVersion: number;
  database: string;
  capturedAt: number;
  sql: string;
}
export interface ErasureLedger {
  kind: string;
  schemaVersion: number;
  database: string;
  capturedAt: number;
  events: {
    id: string;
    entity_type: string;
    entity_id: string;
    action: string;
    revision?: number;
    created_at: number;
  }[];
}
export interface VideoCase {
  id: string;
  kind?: string;
  observedCandidate: boolean;
  jsonExpectedCandidate: boolean | null;
  csvExpectedCandidate: boolean;
  frameCount: number;
  frameRate: number;
  width: number;
  height: number;
  upstreamJsonLabel?: string;
  mediaSha256?: string;
  generatedFrameSha256: string[];
  decodedFrameSha256: string[];
  decodedFrameTimestampMs: number[];
}
export interface AlternatingCase extends VideoCase {
  dependencies: AlternatingVideo['dependencies'];
  upstreamCsvPass: string;
  upstreamCsvDimension: string;
  sourceLabelConflict: boolean;
  jsonAgreement: boolean | null;
  csvAgreement: boolean;
  eventAnnotationsUnscored: AlternatingVideo['eventAnnotations'];
  failureDetailsUnscored: AlternatingVideo['failureDetails'];
  mediaFile: string;
  mediaSha256: string;
  maskDecodedRgbaSha256: string;
  engineStatus: import('../packages/analysis-engine/src/index.ts').AnalysisResult['status'];
  findings: import('../packages/analysis-engine/src/index.ts').AnalysisResult['findings'];
  quality: import('../packages/analysis-engine/src/index.ts').AnalysisResult['quality'];
  analysisBackend: ReturnType<
    typeof import('./detection-kernel.mjs').backendExecution
  >;
}
export interface SpatialReport {
  reference: ReferenceIdentity;
  scope: string;
  engineSource: { sha256: string };
  masks: {
    id: string;
    expectedCandidate: boolean;
    observedCandidate: boolean;
    decodedRgbaSha256: string;
  }[];
  videos: VideoCase[];
}
export interface DetectionCase extends TemporalCase {
  frames: number;
  agreement: boolean;
  engineStatus: import('../packages/analysis-engine/src/index.ts').AnalysisResult['status'];
  analysisBackend: ReturnType<
    typeof import('./detection-kernel.mjs').backendExecution
  >;
  candidates: { startMs: number; endMs: number }[];
  otherCandidateTypes: string[];
}
