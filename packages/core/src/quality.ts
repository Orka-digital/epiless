import type { FrameQuality } from './report.js';

/** Explain why a measurement lost spatial or temporal detail. No pass claim. */
export function captureDetailSummary(
  quality: FrameQuality,
): string | undefined {
  const parts: string[] = [];
  if (quality.spatial) {
    const spatial = quality.spatial;
    parts.push(
      `Bron ${spatial.sourceWidth} × ${spatial.sourceHeight}; analyse ${quality.width} × ${quality.height}. ${spatial.mode === 'NATIVE_PIXELS' ? 'Alle aangeleverde beeldpixels worden onderzocht' : `${(spatial.retainedResolutionRatio * 100).toFixed(1)}% van het aantal bronpixels blijft over; kleine details kunnen verdwijnen`}.`,
    );
  }
  if (quality.processing) {
    const processing = quality.processing;
    parts.push(
      `Verwerking gemiddeld ${processing.meanMs.toFixed(1)} ms per frame; traagste frame ${processing.maxMs.toFixed(1)} ms. Voor 60 fps is ongeveer 16,7 ms per frame beschikbaar.`,
    );
    if (
      processing.conversionMeanMs !== undefined &&
      processing.analysisMeanMs !== undefined
    )
      parts.push(
        `Omzetting naar analysepixels: ${processing.conversionMeanMs.toFixed(1)} ms; detectie: ${processing.analysisMeanMs.toFixed(1)} ms gemiddeld.`,
      );
  }
  return parts.length ? parts.join(' ') : undefined;
}

/** Arrival-clock context, never a synthetic frame rate or a claim of continuous capture. */
export function captureWindowSummary(
  quality: FrameQuality,
): string | undefined {
  if (quality.captureWindowMs === undefined) return undefined;
  const seconds = (milliseconds: number) => (milliseconds / 1000).toFixed(2);
  if (quality.frameCount === 0)
    return `Meetvenster ${seconds(quality.captureWindowMs)} s; geen bruikbare frames geanalyseerd.`;
  const edges = [
    quality.leadingIdleMs !== undefined
      ? `eerste frame na ${seconds(quality.leadingIdleMs)} s`
      : undefined,
    quality.trailingIdleMs !== undefined
      ? `${seconds(quality.trailingIdleMs)} s zonder nieuw frame aan het einde`
      : undefined,
  ].filter(Boolean);
  return `Meetvenster ${seconds(quality.captureWindowMs)} s${edges.length ? ` · ${edges.join(' · ')}` : ''}. Stilstand in de bron en ontbrekende updates zijn hiermee niet te onderscheiden.`;
}
