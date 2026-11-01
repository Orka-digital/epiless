import { startCapture, stopCapture } from './offscreen-source';

import { captureState } from './offscreen-state';

import { beginSegment, endSegment } from './offscreen-segment';

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
      if (
        message.generation &&
        message.generation !== captureState.captureGeneration
      )
        return {};
      if (message.sourceId && message.sourceId !== captureState.captureSourceId)
        return {};
      await stopCapture();
      return {};
    }
    if (
      message.generation !== captureState.captureGeneration ||
      (message.sourceId && message.sourceId !== captureState.captureSourceId) ||
      !captureState.stream?.active ||
      !captureState.analysis
    )
      throw new Error('Capture session is unavailable');
    const commandRevision = captureState.captureRevision;
    if (message.type === 'SEGMENT_BEGIN') {
      return beginSegment(message, commandRevision);
    }
    if (message.type === 'SEGMENT_END') {
      return endSegment(message, commandRevision);
    }
    throw new Error('Unknown capture command');
  })().then(
    (value) => respond({ ok: true, value }),
    async (error) => {
      if (
        message.type === 'CAPTURE_START' &&
        message.generation === captureState.captureGeneration &&
        message.sourceId === captureState.captureSourceId
      )
        await stopCapture();
      respond({ ok: false, error: String(error) });
    },
  );
  return true;
});
