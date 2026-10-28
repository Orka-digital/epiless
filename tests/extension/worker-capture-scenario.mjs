/** @typedef {{format: string, width: number, height: number, disjoint?: boolean, dpr?: number, pageZoom?: number, missingMapping?: boolean, rescaledTransfer?: boolean, rgbaTransfer?: boolean, dense?: boolean, forceJavaScript?: boolean}} WorkerScenario */
/** Exercise the real WebCodecs/worker protocol using numeric buffers only.
 * @param {WorkerScenario} scenario
 */
export async function captureWorkerScenario(scenario) {
  const {
    format,
    width,
    height,
    disjoint,
    rescaledTransfer,
    dpr = 1,
    pageZoom = 1,
    missingMapping,
    dense,
    rgbaTransfer,
    forceJavaScript,
  } = scenario;
  const sourceWidth = rescaledTransfer ? width * 2 : width,
    sourceHeight = rescaledTransfer ? height * 2 : height;
  const worker = new Worker(forceJavaScript ? '/worker-js.js' : '/worker.js'),
    events = [],
    liveEvents = [];
  let empty;
  let warmupEvents;
  let inFlight = 0,
    maximumInFlight = 0,
    completedFrames = 0;
  let nextFrame = 0,
    endQueued = false,
    pendingAtEnd = 0;
  let transferredFramesClosed = true;
  let fillQueue = () => {};
  let ready;
  const preparation = new Promise((resolve) => {
    ready = resolve;
  });
  const result = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Worker timed out')),
      10000,
    );
    worker.onerror = (e) => {
      clearTimeout(timeout);
      reject(new Error(e.message));
    };
    worker.onmessage = (e) => {
      if (e.data.type === 'FRAME_DONE') {
        inFlight--;
        completedFrames++;
        fillQueue();
      }
      if (e.data.type === 'FRAME_ERROR' || e.data.ok === false) {
        clearTimeout(timeout);
        reject(new Error(e.data.error));
        return;
      }
      if (e.data.type === 'CANDIDATE_EVENT') {
        events.push(e.data.finding.id);
        liveEvents.push(e.data);
      }
      if (e.data.id === 'empty') {
        empty = e.data.value;
        warmupEvents = events.length;
        ready();
      }
      if (e.data.id === 'done') {
        clearTimeout(timeout);
        resolve({
          result: e.data.value,
          events,
          liveEvents,
          empty,
          warmupEvents,
          maximumInFlight,
          completedFrames,
          pendingAtEnd,
          transferredFramesClosed,
        });
      }
    };
  });
  worker.postMessage({
    type: 'BEGIN',
    id: 'prepare',
    sourceGeometry: { width: sourceWidth, height: sourceHeight },
    ...(missingMapping
      ? {}
      : {
          referenceMapping: {
            viewport: {
              width: sourceWidth / dpr,
              height: sourceHeight / dpr,
              dpr,
            },
            pageZoom,
            visualScale: 1,
          },
        }),
  });
  worker.postMessage({ type: 'END', id: 'empty' });
  await Promise.race([preparation, result]);
  worker.postMessage({
    type: 'BEGIN',
    id: 'begin',
    sourceGeometry: { width: sourceWidth, height: sourceHeight },
    ...(missingMapping
      ? {}
      : {
          referenceMapping: {
            viewport: {
              width: sourceWidth / dpr,
              height: sourceHeight / dpr,
              dpr,
            },
            pageZoom,
            visualScale: 1,
          },
        }),
  });
  // Match offscreen's bounded three-frame FIFO. END is sent while the last
  // frames are still pending, so ordered draining is actually exercised.
  fillQueue = () => {
    while (nextFrame < 76 && inFlight < 3) {
      const frame = nextFrame++;
      const rgba = new Uint8Array(width * height * 4),
        green = Math.floor(frame / 6) % 2 === 1;
      for (let i = 0; i < rgba.length; i += 4) {
        if (dense) {
          // Every pixel varies, with distinct tile histories and more
          // changed runs than a raw frame. The opposing red/green phases
          // produce real general/red candidates while per-frame low-level
          // variation ensures the dense kernel is genuinely exercised.
          const pixel = i / 4;
          let noise =
            Math.imul(pixel + 1, 0x45d9f3b) ^ Math.imul(frame + 1, 0x27d4eb2d);
          noise = Math.imul(noise ^ (noise >>> 16), 0x45d9f3b) >>> 0;
          rgba[i] = (green ? 5 : 220) + (noise & 15);
          rgba[i + 1] = (green ? 220 : 5) + ((noise >>> 8) & 15);
          rgba[i + 2] = 8 + ((noise >>> 16) & 15);
        } else if (disjoint) {
          const x = ((i / 4) % width) / dpr,
            y = Math.floor(i / 4 / width) / dpr;
          // Each 100x120 rectangle is below 21824 pixels. Their 40-pixel
          // gap keeps them disconnected; one 341x256 field contains both.
          if (
            green &&
            y >= 30 &&
            y < 150 &&
            ((x >= 30 && x < 130) || (x >= 170 && x < 270))
          )
            rgba[i] = rgba[i + 1] = rgba[i + 2] = 255;
        } else {
          rgba[i + (format === 'RGBA' ? 0 : 2)] = green ? 0 : 255;
          rgba[i + 1] = green ? 255 : 0;
        }
        rgba[i + 3] = 255;
      }
      inFlight++;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      if (rescaledTransfer || rgbaTransfer) {
        // The existing fallback transports already converted/rescaled
        // RGBA with the original source extent. Exercise that worker path.
        worker.postMessage(
          {
            type: 'FRAME',
            buffer: rgba.buffer,
            width,
            height,
            sourceWidth,
            sourceHeight,
            timestampMs: (frame * 1000) / 60,
          },
          [rgba.buffer],
        );
        transferredFramesClosed &&= rgba.byteLength === 0;
      } else {
        const source = new VideoFrame(rgba, {
          format,
          codedWidth: width,
          codedHeight: height,
          timestamp: Math.round((frame * 1_000_000) / 60),
          colorSpace: {
            primaries: 'bt709',
            transfer: 'iec61966-2-1',
            matrix: 'rgb',
            fullRange: true,
          },
        });
        worker.postMessage(
          {
            type: 'FRAME',
            frame: source,
            sourceWidth,
            sourceHeight,
            timestampMs: (frame * 1000) / 60,
          },
          [source],
        );
        transferredFramesClosed &&= source.codedWidth === 0;
      }
    }
    if (nextFrame === 76 && !endQueued) {
      endQueued = true;
      pendingAtEnd = inFlight;
      worker.postMessage({ type: 'END', id: 'done' });
    }
  };
  fillQueue();
  try {
    return await result;
  } finally {
    worker.terminate();
  }
}
