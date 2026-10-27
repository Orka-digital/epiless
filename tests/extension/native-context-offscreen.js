// Loaded ONLY as a prefix in an isolated copied build by native-context-guard.
// Observe original messages and stream objects; never produce/modify frames.
(() => {
  const OriginalWorker = globalThis.Worker;
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
    navigator.mediaDevices,
  );
  const streams = [];
  let segment,
    frames = 0;
  const emit = (event) => {
    void chrome.runtime
      .sendMessage({
        target: 'offscreen',
        type: 'FIXTURE_CONTEXT_EVIDENCE',
        event: { at: Date.now(), ...segment, ...event },
      })
      .catch(() => {});
  };
  const finding = (value) => {
    const { id, type, startMs, endMs, region, spatial } = value;
    return { id, type, startMs, endMs, region, spatial };
  };
  globalThis.Worker = class extends OriginalWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', ({ data }) => {
        if (data?.type === 'FRAME_DONE') {
          frames++;
          if (frames === 1 || frames % 30 === 0)
            emit({ kind: 'FRAME_DONE', frames });
        } else if (data?.type === 'CANDIDATE_EVENT') {
          emit({ kind: 'WORKER_CANDIDATE', finding: finding(data.finding) });
        } else if (data?.ok && Array.isArray(data.value?.findings)) {
          emit({
            kind: 'WORKER_RESULT',
            frames,
            findings: data.value.findings.map(finding),
            quality: data.value.quality,
            status: data.value.status,
          });
        }
      });
    }
  };
  navigator.mediaDevices.getUserMedia = async (...args) => {
    const stream = await originalGetUserMedia(...args);
    streams.push(stream);
    // Bound references while retaining every source used by this one-route test.
    if (streams.length > 32) streams.shift();
    emit({ kind: 'REAL_STREAM_CREATED' });
    return stream;
  };
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id || message?.target !== 'offscreen')
      return;
    if (message.type === 'SEGMENT_BEGIN') {
      segment = {
        generation: message.generation,
        segmentId: message.segmentId,
      };
      frames = 0;
      emit({
        kind: 'SEGMENT_BEGIN',
        referenceMapping: message.referenceMapping,
      });
    } else if (message.type === 'SEGMENT_END') emit({ kind: 'SEGMENT_END' });
    else if (message.type === 'CAPTURE_STOP')
      emit({ kind: 'CAPTURE_STOP_REQUEST' });
  });
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'fixture-context-tracks') return;
    port.onMessage.addListener(() => {
      port.postMessage({
        at: Date.now(),
        streams: streams.map((stream) => ({
          active: stream.active,
          tracks: stream.getVideoTracks().map((track) => {
            const { width, height, frameRate, resizeMode } =
              track.getSettings();
            return {
              readyState: track.readyState,
              settings: { width, height, frameRate, resizeMode },
            };
          }),
        })),
      });
    });
  });
})();
