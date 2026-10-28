import { captureState } from './offscreen-state';

/** Send an identified analysis command and reject if its reply misses the bounded deadline. */
export function workerRequest(
  type: 'BEGIN' | 'END',
  interruption?: string,
  sourceGeometry?: { width: number; height: number },
  referenceMapping?: unknown,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => {
      captureState.pending.delete(id);
      reject(new Error('Analysis worker timeout'));
    }, 15_000);
    captureState.pending.set(id, { resolve, reject, timeout });
    captureState.analysis!.postMessage({
      type,
      id,
      interruption,
      sourceGeometry,
      referenceMapping,
    });
  });
}

/** Bind replies and diagnostics to the active capture state; late replies cannot complete another request. */
export function bindAnalysisWorker(
  worker: Worker,
  current: () => boolean,
  generation: string,
  sourceId: string,
): void {
  worker.onmessage = (event) => {
    if (!current()) return;
    const message = event.data;
    if (message.type === 'CANDIDATE_EVENT') {
      const finding = message.finding;
      const diagnostic = finding?.diagnostic;
      if (
        captureState.segmentId &&
        diagnostic &&
        finding.region &&
        Number.isFinite(message.sourceTimestampOrigin)
      ) {
        const aligned = captureState.sourceFrameClock.resolve(
          message.sourceTimestampOrigin + diagnostic.windowStartMs,
          message.sourceTimestampOrigin + diagnostic.windowEndMs,
        );
        if (!aligned) return;
        void chrome.runtime
          .sendMessage({
            target: 'background',
            type: 'CANDIDATE_EVENT',
            generation,
            segmentId: captureState.segmentId,
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
      captureState.inFlightFrames = Math.max(
        0,
        captureState.inFlightFrames - 1,
      );
      return;
    }
    if (message.type === 'FRAME_ERROR') {
      captureState.inFlightFrames = Math.max(
        0,
        captureState.inFlightFrames - 1,
      );
      captureState.skipped++;
      return;
    }
    const request = captureState.pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timeout);
    captureState.pending.delete(message.id);
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
}
