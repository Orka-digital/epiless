import type { AnalysisResult } from '@epi-less/analysis-engine';
import {
  CaptureCoverage,
  captureDimensions,
  validateCaptureViewport,
  withCaptureCoverage,
  type CaptureViewport,
} from './capture-quality';
import { SourceFrameClock } from './source-timeline-clock';

let stream: MediaStream | undefined;
let video: HTMLVideoElement | undefined;
let analysis: Worker | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let callback = 0;
let collecting = false;
// Includes the frame currently being analysed. FIFO worker message ordering
// allows brief processing spikes to catch up without unbounded frame retention.
const MAX_IN_FLIGHT_FRAMES = 3;
let inFlightFrames = 0;
let skipped = 0;
let presentedFrames = 0;
let captureGeneration = '';
let captureSourceId = '';
let captureRevision = 0;
let coverage: CaptureCoverage | undefined;
let segmentId = '';
const sourceFrameClock = new SourceFrameClock();
let expectedViewport: CaptureViewport | undefined;
let geometryMismatches = 0;
let lastMismatchedGeometry = '';
let lastDecodedGeometry: { width: number; height: number } | undefined;
let geometryWaiter:
  { width: number; height: number; resolve: () => void } | undefined;
let frameReader: ReadableStreamDefaultReader<VideoFrame> | undefined;
type TrackProcessorConstructor = new (options: {
  track: MediaStreamTrack;
  maxBufferSize: number;
}) => { readable: ReadableStream<VideoFrame> };
const pending = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

function workerRequest(
  type: 'BEGIN' | 'END',
  interruption?: string,
  sourceGeometry?: { width: number; height: number },
  referenceMapping?: unknown,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Analysis worker timeout'));
    }, 15_000);
    pending.set(id, { resolve, reject, timeout });
    analysis!.postMessage({
      type,
      id,
      interruption,
      sourceGeometry,
      referenceMapping,
    });
  });
}
async function stopCapture() {
  captureRevision++;
  collecting = false;
  coverage = undefined;
  sourceFrameClock.reset();
  lastDecodedGeometry = undefined;
  geometryWaiter?.resolve();
  geometryWaiter = undefined;
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = undefined;
  if (callback && video) video.cancelVideoFrameCallback(callback);
  callback = 0;
  void frameReader?.cancel().catch(() => undefined);
  frameReader = undefined;
  for (const track of stream?.getTracks() ?? []) {
    track.onended = null;
    track.stop();
  }
  stream = undefined;
  if (video) {
    video.pause();
    video.srcObject = null;
    video.remove();
    video = undefined;
  }
  analysis?.terminate();
  analysis = undefined;
  for (const request of pending.values()) {
    clearTimeout(request.timeout);
    request.reject(new Error('Capture ended'));
  }
  pending.clear();
  inFlightFrames = 0;
}
async function negotiateViewport(
  viewport: CaptureViewport | undefined,
): Promise<void> {
  if (!viewport) return;
  const revision = captureRevision;
  const width = Math.round(viewport.width * viewport.dpr),
    height = Math.round(viewport.height * viewport.dpr);
  const track = stream?.getVideoTracks()[0];
  if (!track) throw new Error('Capture track is unavailable');
  try {
    await track.applyConstraints({
      width: { exact: width },
      height: { exact: height },
      frameRate: { ideal: 60, max: 60 },
      resizeMode: { exact: 'none' },
    } as MediaTrackConstraints);
  } catch (error) {
    // Keep just geometry/cadence capabilities. Never include device/group IDs
    // from the browser's full settings/capabilities objects in a report.
    const settings = track.getSettings();
    const capabilities = track.getCapabilities?.();
    const details = {
      requested: { width, height, resizeMode: 'none' },
      constraint:
        typeof (error as { constraint?: unknown })?.constraint === 'string'
          ? String((error as { constraint: string }).constraint).slice(0, 80)
          : 'UNKNOWN',
      settings: {
        width: settings.width,
        height: settings.height,
        frameRate: settings.frameRate,
        resizeMode: (settings as MediaTrackSettings & { resizeMode?: string })
          .resizeMode,
      },
      capabilities: {
        width: capabilities?.width,
        height: capabilities?.height,
        frameRate: capabilities?.frameRate,
        resizeMode: (
          capabilities as
            (MediaTrackCapabilities & { resizeMode?: string[] }) | undefined
        )?.resizeMode,
      },
      decoded: lastDecodedGeometry,
    };
    throw new Error(
      `CAPTURE_VIEWPORT_CONSTRAINT_FAILED: ${JSON.stringify(details)}; ${String(error).slice(0, 200)}`,
    );
  }
  if (revision !== captureRevision)
    throw new Error('CAPTURE_SOURCE_CHANGED_DURING_NEGOTIATION');
  if (
    lastDecodedGeometry?.width === width &&
    lastDecodedGeometry.height === height
  )
    return;
  // Let already queued frames with the previous geometry drain before BEGIN.
  // A quiet/static source may deliver no next frame: the normal coverage and
  // per-frame geometry guards then retain an explicitly inconclusive segment.
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      if (geometryWaiter?.resolve === finish) geometryWaiter = undefined;
      resolve();
    };
    const timer = setTimeout(finish, 1500);
    geometryWaiter = { width, height, resolve: finish };
  });
  if (revision !== captureRevision)
    throw new Error('CAPTURE_SOURCE_CHANGED_DURING_NEGOTIATION');
}
async function startCapture(
  streamId: string,
  generation: string,
  sourceId: string,
  viewportInput?: unknown,
) {
  await stopCapture();
  const revision = captureRevision;
  captureGeneration = generation;
  captureSourceId = sourceId;
  const viewport =
    viewportInput === undefined
      ? undefined
      : validateCaptureViewport(viewportInput);
  const geometry = viewport
    ? {
        minWidth: Math.round(viewport.width * viewport.dpr),
        maxWidth: Math.round(viewport.width * viewport.dpr),
        minHeight: Math.round(viewport.height * viewport.dpr),
        maxHeight: Math.round(viewport.height * viewport.dpr),
      }
    : {};
  const acquired = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
        maxFrameRate: 60,
        ...geometry,
      },
    } as MediaTrackConstraints,
  });
  if (revision !== captureRevision) {
    for (const track of acquired.getTracks()) track.stop();
    throw new Error('CAPTURE_SOURCE_START_CANCELLED');
  }
  stream = acquired;
  // maxFrameRate alone leaves Chrome's default at 30 fps. Request 60 explicitly,
  // then assess delivered frame timestamps rather than assuming it was granted.
  await stream
    .getVideoTracks()[0]
    .applyConstraints({ frameRate: { ideal: 60, max: 60 } })
    .catch(() => undefined);
  if (revision !== captureRevision)
    throw new Error('CAPTURE_SOURCE_START_CANCELLED');
  const worker = new Worker(chrome.runtime.getURL('analysis-worker.js'));
  analysis = worker;
  const current = () =>
    analysis === worker &&
    generation === captureGeneration &&
    revision === captureRevision;
  worker.onmessage = (event) => {
    if (!current()) return;
    const message = event.data;
    if (message.type === 'CANDIDATE_EVENT') {
      const finding = message.finding;
      const diagnostic = finding?.diagnostic;
      if (
        segmentId &&
        diagnostic &&
        finding.region &&
        Number.isFinite(message.sourceTimestampOrigin)
      ) {
        const aligned = sourceFrameClock.resolve(
          message.sourceTimestampOrigin + diagnostic.windowStartMs,
          message.sourceTimestampOrigin + diagnostic.windowEndMs,
        );
        if (!aligned) return;
        void chrome.runtime
          .sendMessage({
            target: 'background',
            type: 'CANDIDATE_EVENT',
            generation,
            segmentId,
            findingId: finding.id,
            windowStartMs: diagnostic.windowStartMs,
            windowEndMs: diagnostic.windowEndMs,
            ...aligned,
            analysis: {
              width: diagnostic.analysisWidth,
              height: diagnostic.analysisHeight,
            },
            region: finding.region,
            source: {
              width: diagnostic.sourceWidth,
              height: diagnostic.sourceHeight,
            },
          })
          .catch(() => undefined);
      }
      return;
    }
    if (message.type === 'FRAME_DONE') {
      inFlightFrames = Math.max(0, inFlightFrames - 1);
      return;
    }
    if (message.type === 'FRAME_ERROR') {
      inFlightFrames = Math.max(0, inFlightFrames - 1);
      skipped++;
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timeout);
    pending.delete(message.id);
    if (message.ok) request.resolve(message.value);
    else request.reject(new Error(message.error));
  };
  worker.onerror = () => {
    if (!current()) return;
    void chrome.runtime.sendMessage({
      target: 'background',
      type: 'CAPTURE_LOST',
      generation,
      sourceId,
      reason: 'ANALYSIS_WORKER_FAILED',
    });
  };
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', {
    willReadFrequently: true,
    colorSpace: 'srgb',
  });
  if (!context) throw new Error('Pixel canvas is unavailable');
  const submitFrame = (
    source: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
    timestampMs: number,
  ) => {
    if (!current()) return;
    lastDecodedGeometry = { width: sourceWidth, height: sourceHeight };
    if (
      geometryWaiter?.width === sourceWidth &&
      geometryWaiter.height === sourceHeight
    )
      geometryWaiter.resolve();
    if (!collecting) return;
    if (inFlightFrames >= MAX_IN_FLIGHT_FRAMES) {
      skipped++;
      return;
    }
    if (!sourceWidth || !sourceHeight) return;
    if (
      expectedViewport &&
      (sourceWidth !==
        Math.round(expectedViewport.width * expectedViewport.dpr) ||
        sourceHeight !==
          Math.round(expectedViewport.height * expectedViewport.dpr))
    ) {
      geometryMismatches++;
      lastMismatchedGeometry = `${sourceWidth}x${sourceHeight}`;
      return;
    }
    const { width, height } = captureDimensions(sourceWidth, sourceHeight);
    try {
      const receiptEpochMs = performance.timeOrigin + performance.now();
      inFlightFrames++;
      if (typeof VideoFrame !== 'undefined' && source instanceof VideoFrame) {
        // Transfer the decoded frame, keeping GPU conversion/readback off the
        // offscreen main thread. Ownership ends in the worker's finally block.
        worker.postMessage(
          {
            type: 'FRAME',
            frame: source,
            sourceWidth,
            sourceHeight,
            timestampMs,
          },
          [source],
        );
        sourceFrameClock.add(timestampMs, receiptEpochMs);
        coverage?.frameSubmitted(performance.now());
        return;
      }
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.drawImage(source, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      // Decoded-frame timestamps only; timer intervals never stand in for observed cadence.
      worker.postMessage(
        {
          type: 'FRAME',
          buffer: pixels.buffer,
          width,
          height,
          sourceWidth,
          sourceHeight,
          timestampMs,
        },
        [pixels.buffer],
      );
      sourceFrameClock.add(timestampMs, receiptEpochMs);
      coverage?.frameSubmitted(performance.now());
    } catch {
      inFlightFrames = Math.max(0, inFlightFrames - 1);
      skipped++;
    }
  };
  const Processor = (
    globalThis as typeof globalThis & {
      MediaStreamTrackProcessor?: TrackProcessorConstructor;
    }
  ).MediaStreamTrackProcessor;
  if (Processor) {
    // Direct frame reads continue when an offscreen document has no compositor updates.
    const reader = new Processor({
      track: stream.getVideoTracks()[0],
      maxBufferSize: 1,
    }).readable.getReader();
    frameReader = reader;
    void (async () => {
      while (frameReader === reader && current()) {
        const result = await reader.read();
        if (result.done) {
          if (frameReader === reader && current())
            void chrome.runtime.sendMessage({
              target: 'background',
              type: 'CAPTURE_LOST',
              generation,
              sourceId,
              reason: 'FRAME_READER_ENDED',
            });
          break;
        }
        const frame = result.value;
        try {
          if (frameReader !== reader || !current()) continue;
          submitFrame(
            frame,
            frame.displayWidth,
            frame.displayHeight,
            frame.timestamp / 1000,
          );
        } finally {
          frame.close();
        }
      }
    })().catch(() => {
      if (frameReader === reader && current())
        void chrome.runtime.sendMessage({
          target: 'background',
          type: 'CAPTURE_LOST',
          generation,
          sourceId,
          reason: 'FRAME_READER_FAILED',
        });
    });
  } else {
    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    document.body.append(video);
    await video.play();
    if (!current()) throw new Error('CAPTURE_SOURCE_START_CANCELLED');
    if (!video.requestVideoFrameCallback)
      throw new Error('Real video frame timestamps are unavailable');
    const frame: VideoFrameRequestCallback = (_now, metadata) => {
      if (!video || !stream || !current()) return;
      callback = video.requestVideoFrameCallback(frame);
      if (
        collecting &&
        presentedFrames &&
        metadata.presentedFrames > presentedFrames + 1
      )
        skipped += metadata.presentedFrames - presentedFrames - 1;
      presentedFrames = metadata.presentedFrames;
      submitFrame(
        video,
        metadata.width || video.videoWidth,
        metadata.height || video.videoHeight,
        metadata.mediaTime * 1000,
      );
    };
    callback = video.requestVideoFrameCallback(frame);
  }
  for (const track of stream.getTracks())
    track.onended = () => {
      if (!current()) return;
      void chrome.runtime.sendMessage({
        target: 'background',
        type: 'CAPTURE_LOST',
        generation,
        sourceId,
        reason: 'CAPTURE_TRACK_ENDED',
      });
    };
  heartbeat = setInterval(() => {
    if (!current()) return;
    void chrome.runtime
      .sendMessage({
        target: 'background',
        type: 'CAPTURE_HEARTBEAT',
        generation,
      })
      .catch(() => {
        if (current()) return stopCapture();
      });
  }, 20_000);
  await negotiateViewport(viewport);
  if (!current()) throw new Error('CAPTURE_SOURCE_START_CANCELLED');
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.target !== 'offscreen')
    return;
  void (async () => {
    if (message.type === 'CAPTURE_START') {
      if (typeof message.sourceId !== 'string' || !message.sourceId)
        throw new Error('CAPTURE_SOURCE_ID_REQUIRED');
      await startCapture(
        message.streamId,
        message.generation,
        message.sourceId,
        message.expectedViewport ?? message.sourceViewport,
      );
      return { started: true };
    }
    if (message.type === 'CAPTURE_STOP') {
      if (message.generation && message.generation !== captureGeneration)
        return {};
      if (message.sourceId && message.sourceId !== captureSourceId) return {};
      await stopCapture();
      return {};
    }
    if (
      message.generation !== captureGeneration ||
      (message.sourceId && message.sourceId !== captureSourceId) ||
      !stream?.active ||
      !analysis
    )
      throw new Error('Capture session is unavailable');
    const commandRevision = captureRevision;
    if (message.type === 'SEGMENT_BEGIN') {
      collecting = false;
      const requestedViewport =
        message.expectedViewport ?? message.sourceViewport;
      const validatedViewport =
        requestedViewport === undefined
          ? undefined
          : validateCaptureViewport(requestedViewport);
      await negotiateViewport(validatedViewport);
      if (
        message.generation !== captureGeneration ||
        commandRevision !== captureRevision ||
        !analysis ||
        !stream?.active
      )
        throw new Error('Capture session ended during viewport negotiation');
      const sourceGeometry = validatedViewport
        ? {
            width: Math.round(validatedViewport.width * validatedViewport.dpr),
            height: Math.round(
              validatedViewport.height * validatedViewport.dpr,
            ),
          }
        : lastDecodedGeometry;
      await workerRequest(
        'BEGIN',
        undefined,
        sourceGeometry,
        message.referenceMapping,
      );
      if (
        message.generation !== captureGeneration ||
        commandRevision !== captureRevision ||
        !analysis ||
        !stream?.active
      )
        throw new Error('Capture session ended during analysis preparation');
      inFlightFrames = 0;
      skipped = 0;
      segmentId =
        typeof message.segmentId === 'string' ? message.segmentId : '';
      sourceFrameClock.reset();
      expectedViewport = undefined;
      geometryMismatches = 0;
      lastMismatchedGeometry = '';
      expectedViewport = validatedViewport;
      presentedFrames = 0;
      coverage = new CaptureCoverage(performance.now());
      collecting = true;
      return {};
    }
    if (message.type === 'SEGMENT_END') {
      collecting = false;
      const window = coverage?.finish(performance.now());
      coverage = undefined;
      const skippedBeforeEnd = skipped;
      const measurement = (await workerRequest(
        'END',
        geometryMismatches && expectedViewport
          ? `CAPTURE_VIEWPORT_MISMATCH: ${geometryMismatches} decoded frames (${lastMismatchedGeometry} latest) did not match ${Math.round(expectedViewport.width * expectedViewport.dpr)}x${Math.round(expectedViewport.height * expectedViewport.dpr)} source pixels for the requested ${expectedViewport.width}x${expectedViewport.height} CSS viewport at DPR ${expectedViewport.dpr}. Those frames were not analyzed.`
          : message.interruption ||
              (skipped
                ? `${skipped} source/analysis frames were skipped or unavailable.`
                : undefined),
      )) as AnalysisResult;
      if (
        message.generation !== captureGeneration ||
        commandRevision !== captureRevision ||
        !stream?.active
      )
        throw new Error('Capture session ended while draining analysis');
      // END is queued behind every transferred frame. A queued conversion can
      // still fail after END was requested; retain that failure in the result.
      if (skipped > skippedBeforeEnd) {
        measurement.status = 'INCONCLUSIVE';
        measurement.quality.interrupted = true;
        measurement.limitations.push(
          `${skipped - skippedBeforeEnd} queued source/analysis frames failed while completing the segment; ${skipped} total frames were skipped or unavailable.`,
        );
      }
      const settings = stream.getVideoTracks()[0]?.getSettings();
      if (measurement.quality.processing && settings) {
        const details = settings as MediaTrackSettings & {
          resizeMode?: string;
        };
        measurement.quality.processing.track = {
          ...(settings.width ? { width: settings.width } : {}),
          ...(settings.height ? { height: settings.height } : {}),
          ...(Number.isFinite(settings.frameRate)
            ? { frameRate: settings.frameRate }
            : {}),
          ...(details.resizeMode ? { resizeMode: details.resizeMode } : {}),
        };
      }
      return window ? withCaptureCoverage(measurement, window) : measurement;
    }
    throw new Error('Unknown capture command');
  })().then(
    (value) => respond({ ok: true, value }),
    async (error) => {
      if (
        message.type === 'CAPTURE_START' &&
        message.generation === captureGeneration &&
        message.sourceId === captureSourceId
      )
        await stopCapture();
      respond({ ok: false, error: String(error) });
    },
  );
  return true;
});
