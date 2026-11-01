import { CaptureCoverage, type CaptureViewport } from './capture-quality';

import { SourceFrameClock } from './source-timeline-clock';

// Includes the frame currently being analysed. FIFO worker message ordering
// allows brief processing spikes to catch up without unbounded frame retention.
export const MAX_IN_FLIGHT_FRAMES = 3;

export type TrackProcessorConstructor = new (options: {
  track: MediaStreamTrack;
  maxBufferSize: number;
}) => { readable: ReadableStream<VideoFrame> };

export const captureState: {
  stream: MediaStream | undefined;
  video: HTMLVideoElement | undefined;
  analysis: Worker | undefined;
  heartbeat: ReturnType<typeof setInterval> | undefined;
  callback: number;
  collecting: boolean;
  inFlightFrames: number;
  skipped: number;
  presentedFrames: number;
  captureGeneration: string;
  captureSourceId: string;
  captureRevision: number;
  coverage: CaptureCoverage | undefined;
  segmentId: string;
  sourceFrameClock: SourceFrameClock;
  expectedViewport: CaptureViewport | undefined;
  geometryMismatches: number;
  lastMismatchedGeometry: string;
  lastDecodedGeometry: { width: number; height: number } | undefined;
  geometryWaiter:
    { width: number; height: number; resolve: () => void } | undefined;
  frameReader: ReadableStreamDefaultReader<VideoFrame> | undefined;
  pending: Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >;
} = {
  stream: undefined,
  video: undefined,
  analysis: undefined,
  heartbeat: undefined,
  callback: 0,
  collecting: false,
  inFlightFrames: 0,
  skipped: 0,
  presentedFrames: 0,
  captureGeneration: '',
  captureSourceId: '',
  captureRevision: 0,
  coverage: undefined,
  segmentId: '',
  sourceFrameClock: new SourceFrameClock(),
  expectedViewport: undefined,
  geometryMismatches: 0,
  lastMismatchedGeometry: '',
  lastDecodedGeometry: undefined,
  geometryWaiter: undefined,
  frameReader: undefined,
  pending: new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >(),
};
