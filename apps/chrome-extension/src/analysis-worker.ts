import { FrameAnalyzer } from '@epi-less/analysis-engine';
import { captureDimensions, NATIVE_PIXEL_BUDGET } from './capture-quality';
import { FrameConverter } from './frame-conversion';
import { warmAnalysisRuntime } from './analysis-warmup';
import type { ProcessingQuality } from '@epi-less/core';
import { cssReferenceField } from './reference-field';

let analyzer: FrameAnalyzer | undefined;
const converter = new FrameConverter();
let measuredFrames = 0,
  totalMs = 0,
  maxMs = 0,
  framesOver16_7Ms = 0,
  liveCandidates = 0;
let conversionTotalMs = 0,
  analysisTotalMs = 0;
let decoded: ProcessingQuality['decoded'];
const conversionMethods = new Set<
  NonNullable<ProcessingQuality['conversionMethods']>[number]
>();
let sourceTimestampOrigin: number | undefined;
let warmed = false;
let referenceUnavailable: string | undefined;
const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (value: unknown) => void;
};
let pending = Promise.resolve();
scope.onmessage = (event) => {
  pending = pending.then(() => handle(event));
};
async function handle(event: MessageEvent) {
  const message = event.data;
  try {
    if (message.type === 'BEGIN') {
      // BEGIN is acknowledged only after preparation. Offscreen keeps collecting
      // disabled until that acknowledgement; no warmup data enters this analyzer.
      if (!warmed) {
        warmAnalysisRuntime();
        warmed = true;
      }
      measuredFrames = totalMs = maxMs = framesOver16_7Ms = liveCandidates = 0;
      conversionTotalMs = analysisTotalMs = 0;
      decoded = undefined;
      conversionMethods.clear();
      sourceTimestampOrigin = undefined;
      const reference = cssReferenceField(
        message.sourceGeometry,
        message.referenceMapping,
      );
      referenceUnavailable = reference.unavailable;
      converter.releaseInput();
      analyzer = new FrameAnalyzer({
        minEffectiveFps: 50,
        maxGapMs: 100,
        maxPixels: NATIVE_PIXEL_BUDGET,
        // Native source pixels mapped from the explicitly verified CSS context.
        // Rescaling suppresses the field inside the engine; raw candidates remain.
        ...(reference.field ? { visualField: reference.field } : {}),
        onCandidate: (finding) => {
          if (liveCandidates++ >= 8) return;
          scope.postMessage({
            type: 'CANDIDATE_EVENT',
            finding,
            sourceTimestampOrigin,
          });
        },
      });
      if (message.sourceGeometry) {
        const { width, height } = captureDimensions(
          message.sourceGeometry.width,
          message.sourceGeometry.height,
        );
        analyzer.prepare(width, height);
        converter.prepare(
          message.sourceGeometry.width,
          message.sourceGeometry.height,
          analyzer.getInputRgba(),
        );
      }
      scope.postMessage({ id: message.id, ok: true });
    } else if (message.type === 'FRAME' && analyzer) {
      const started = performance.now();
      const previousInput = analyzer.getInputRgba();
      let conversionMs = 0,
        analysisMs = 0;
      sourceTimestampOrigin ??= message.timestampMs;
      try {
        let rgba: Uint8ClampedArray, width: number, height: number;
        if (message.frame) {
          const frame: VideoFrame = message.frame,
            visible = frame.visibleRect;
          decoded = {
            codedWidth: frame.codedWidth,
            codedHeight: frame.codedHeight,
            displayWidth: frame.displayWidth,
            displayHeight: frame.displayHeight,
            ...(visible
              ? {
                  visibleRect: {
                    x: visible.x,
                    y: visible.y,
                    width: visible.width,
                    height: visible.height,
                  },
                }
              : {}),
            format: frame.format ?? 'UNKNOWN',
            primaries: frame.colorSpace.primaries ?? 'UNKNOWN',
            transfer: frame.colorSpace.transfer ?? 'UNKNOWN',
            matrix: frame.colorSpace.matrix ?? 'UNKNOWN',
          };
          const geometry = captureDimensions(
            message.sourceWidth,
            message.sourceHeight,
          );
          const input = analyzer.getInputRgba();
          const converted = await converter.convert(
            frame,
            message.sourceWidth,
            message.sourceHeight,
            input?.length === geometry.width * geometry.height * 4
              ? input
              : undefined,
          );
          ({ rgba, width, height } = converted);
          conversionMethods.add(converted.method);
        } else {
          converter.releaseInput();
          rgba = new Uint8ClampedArray(message.buffer);
          width = message.width;
          height = message.height;
          conversionMethods.add('RGBA_TRANSFER');
        }
        const convertedAt = performance.now();
        conversionMs = convertedAt - started;
        analyzer.pushFrame({
          rgba,
          width,
          height,
          timestampMs: message.timestampMs,
          sourceWidth: message.sourceWidth,
          sourceHeight: message.sourceHeight,
        });
        analysisMs = performance.now() - convertedAt;
        if (analyzer.getInputRgba() !== previousInput) converter.releaseInput();
      } finally {
        message.frame?.close();
      }
      const elapsed = performance.now() - started;
      measuredFrames++;
      conversionTotalMs += conversionMs;
      analysisTotalMs += analysisMs;
      totalMs += elapsed;
      maxMs = Math.max(maxMs, elapsed);
      if (elapsed > 1000 / 60) framesOver16_7Ms++;
      scope.postMessage({ type: 'FRAME_DONE' });
    } else if (message.type === 'END' && analyzer) {
      if (message.interruption) analyzer.markInterrupted(message.interruption);
      const result = analyzer.finish();
      if (referenceUnavailable) result.limitations.push(referenceUnavailable);
      result.quality.processing = {
        measuredFrames,
        meanMs: measuredFrames ? totalMs / measuredFrames : 0,
        maxMs,
        framesOver16_7Ms,
        scope: 'WORKER_CONVERSION_AND_ANALYSIS',
        conversionMeanMs: measuredFrames
          ? conversionTotalMs / measuredFrames
          : 0,
        analysisMeanMs: measuredFrames ? analysisTotalMs / measuredFrames : 0,
        conversionMethods: [...conversionMethods],
        analysisBackend: analyzer.getBackendStats(),
        ...(decoded ? { decoded } : {}),
      };
      if (liveCandidates > 8)
        result.limitations.push(
          'The eight-event live DOM diagnostic budget was reached; remaining pixel findings are retained without a live source event.',
        );
      analyzer = undefined;
      converter.releaseInput();
      scope.postMessage({ id: message.id, ok: true, value: result });
    } else throw new Error('No active analysis segment');
  } catch (error) {
    scope.postMessage({
      id: message.id,
      type: message.type === 'FRAME' ? 'FRAME_ERROR' : undefined,
      ok: false,
      error: String(error),
    });
  }
}
