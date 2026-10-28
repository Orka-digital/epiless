import { validateCaptureViewport } from './capture-quality';

import { captureState } from './offscreen-state';

import { bindAnalysisWorker } from './offscreen-worker';

import { createFrameSubmission, startFrameDelivery } from './offscreen-frames';
import { negotiateViewport } from './offscreen-geometry';

/** Release capture resources and pending analysis ownership; revision changes invalidate late asynchronous acquisition. */
export async function stopCapture() {
  captureState.captureRevision++;
  captureState.collecting = false;
  captureState.coverage = undefined;
  captureState.sourceFrameClock.reset();
  captureState.lastDecodedGeometry = undefined;
  captureState.geometryWaiter?.resolve();
  captureState.geometryWaiter = undefined;
  if (captureState.heartbeat) clearInterval(captureState.heartbeat);
  captureState.heartbeat = undefined;
  if (captureState.callback && captureState.video)
    captureState.video.cancelVideoFrameCallback(captureState.callback);
  captureState.callback = 0;
  void captureState.frameReader?.cancel().catch(() => undefined);
  captureState.frameReader = undefined;
  for (const track of captureState.stream?.getTracks() ?? []) {
    track.onended = null;
    track.stop();
  }
  captureState.stream = undefined;
  if (captureState.video) {
    captureState.video.pause();
    captureState.video.srcObject = null;
    captureState.video.remove();
    captureState.video = undefined;
  }
  captureState.analysis?.terminate();
  captureState.analysis = undefined;
  for (const request of captureState.pending.values()) {
    clearTimeout(request.timeout);
    request.reject(new Error('Capture ended'));
  }
  captureState.pending.clear();
  captureState.inFlightFrames = 0;
}

/** Acquire the authorized stream and initialize frame analysis; abandon acquisitions superseded by stop or restart. */
export async function startCapture(
  streamId: string,
  generation: string,
  sourceId: string,
  viewportInput?: unknown,
) {
  await stopCapture();
  const revision = captureState.captureRevision;
  captureState.captureGeneration = generation;
  captureState.captureSourceId = sourceId;
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
  if (revision !== captureState.captureRevision) {
    for (const track of acquired.getTracks()) track.stop();
    throw new Error('CAPTURE_SOURCE_START_CANCELLED');
  }
  captureState.stream = acquired;
  // maxFrameRate alone leaves Chrome's default at 30 fps. Request 60 explicitly,
  // then assess delivered frame timestamps rather than assuming it was granted.
  await captureState.stream
    .getVideoTracks()[0]
    .applyConstraints({ frameRate: { ideal: 60, max: 60 } })
    .catch(() => undefined);
  if (revision !== captureState.captureRevision)
    throw new Error('CAPTURE_SOURCE_START_CANCELLED');
  const worker = new Worker(chrome.runtime.getURL('analysis-worker.js'));
  captureState.analysis = worker;
  const current = () =>
    captureState.analysis === worker &&
    generation === captureState.captureGeneration &&
    revision === captureState.captureRevision;
  bindAnalysisWorker(worker, current, generation, sourceId);
  const submitFrame = createFrameSubmission(worker, current);
  await startFrameDelivery(
    current,
    generation,
    sourceId,
    captureState.stream,
    submitFrame,
  );
  for (const track of captureState.stream.getTracks())
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
  captureState.heartbeat = setInterval(() => {
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
export { negotiateViewport } from './offscreen-geometry';
