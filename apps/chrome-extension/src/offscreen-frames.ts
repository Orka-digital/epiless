import { captureDimensions } from './capture-quality';

import {
  captureState,
  MAX_IN_FLIGHT_FRAMES,
  type TrackProcessorConstructor,
} from './offscreen-state';

/** Create the frame submission path with bounded worker pressure and explicit dropped-frame accounting. */
export function createFrameSubmission(worker: Worker, current: () => boolean) {
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
    captureState.lastDecodedGeometry = {
      width: sourceWidth,
      height: sourceHeight,
    };
    if (
      captureState.geometryWaiter?.width === sourceWidth &&
      captureState.geometryWaiter.height === sourceHeight
    )
      captureState.geometryWaiter.resolve();
    if (!captureState.collecting) return;
    if (captureState.inFlightFrames >= MAX_IN_FLIGHT_FRAMES) {
      captureState.skipped++;
      return;
    }
    if (!sourceWidth || !sourceHeight) return;
    if (
      captureState.expectedViewport &&
      (sourceWidth !==
        Math.round(
          captureState.expectedViewport.width *
            captureState.expectedViewport.dpr,
        ) ||
        sourceHeight !==
          Math.round(
            captureState.expectedViewport.height *
              captureState.expectedViewport.dpr,
          ))
    ) {
      captureState.geometryMismatches++;
      captureState.lastMismatchedGeometry = `${sourceWidth}x${sourceHeight}`;
      return;
    }
    const { width, height } = captureDimensions(sourceWidth, sourceHeight);
    try {
      const receiptEpochMs = performance.timeOrigin + performance.now();
      captureState.inFlightFrames++;
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
        captureState.sourceFrameClock.add(timestampMs, receiptEpochMs);
        captureState.coverage?.frameSubmitted(performance.now());
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
      captureState.sourceFrameClock.add(timestampMs, receiptEpochMs);
      captureState.coverage?.frameSubmitted(performance.now());
    } catch {
      captureState.inFlightFrames = Math.max(
        0,
        captureState.inFlightFrames - 1,
      );
      captureState.skipped++;
    }
  };
  return submitFrame;
}

/** Start native or canvas frame delivery for the acquired stream; callbacks stop when capture ownership ends. */
export async function startFrameDelivery(
  current: () => boolean,
  generation: string,
  sourceId: string,
  stream: MediaStream,
  submitFrame: ReturnType<typeof createFrameSubmission>,
): Promise<void> {
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
    captureState.frameReader = reader;
    void (async () => {
      while (captureState.frameReader === reader && current()) {
        const result = await reader.read();
        if (result.done) {
          if (captureState.frameReader === reader && current())
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
          if (captureState.frameReader !== reader || !current()) continue;
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
      if (captureState.frameReader === reader && current())
        void chrome.runtime.sendMessage({
          target: 'background',
          type: 'CAPTURE_LOST',
          generation,
          sourceId,
          reason: 'FRAME_READER_FAILED',
        });
    });
  } else {
    captureState.video = document.createElement('video');
    captureState.video.muted = true;
    captureState.video.playsInline = true;
    captureState.video.srcObject = stream;
    document.body.append(captureState.video);
    await captureState.video.play();
    if (!current()) throw new Error('CAPTURE_SOURCE_START_CANCELLED');
    if (!captureState.video.requestVideoFrameCallback)
      throw new Error('Real video frame timestamps are unavailable');
    const frame: VideoFrameRequestCallback = (_now, metadata) => {
      if (!captureState.video || !captureState.stream || !current()) return;
      captureState.callback =
        captureState.video.requestVideoFrameCallback(frame);
      if (
        captureState.collecting &&
        captureState.presentedFrames &&
        metadata.presentedFrames > captureState.presentedFrames + 1
      )
        captureState.skipped +=
          metadata.presentedFrames - captureState.presentedFrames - 1;
      captureState.presentedFrames = metadata.presentedFrames;
      submitFrame(
        captureState.video,
        metadata.width || captureState.video.videoWidth,
        metadata.height || captureState.video.videoHeight,
        metadata.mediaTime * 1000,
      );
    };
    captureState.callback = captureState.video.requestVideoFrameCallback(frame);
  }
}
