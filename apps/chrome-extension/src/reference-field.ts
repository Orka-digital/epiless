import type { VisualFieldCalibration } from '@epi-less/analysis-engine';

interface ReferenceMapping {
  viewport: { width: number; height: number; dpr: number };
  pageZoom: number;
  visualScale: number;
}

/** W3C Understanding 2.3.1 substitutes CSS pixels for the historical block.
 * Only apply that reference at standard page/pinch zoom and a verified native
 * source mapping. This is an assumed field, not measured physical geometry. */
export function cssReferenceField(
  source: { width: number; height: number } | undefined,
  input: unknown,
): { field?: VisualFieldCalibration; unavailable?: string } {
  const mapping = input as Partial<ReferenceMapping> | null | undefined;
  const viewport = mapping?.viewport;
  if (
    !source ||
    !viewport ||
    ![source.width, source.height, viewport.width, viewport.height].every(
      (n) => Number.isInteger(n) && n > 0 && n <= 16384,
    ) ||
    !Number.isFinite(viewport.dpr) ||
    viewport.dpr <= 0 ||
    viewport.dpr > 16
  )
    return { unavailable: 'CSS_REFERENCE_MAPPING_UNAVAILABLE' };
  if (mapping?.pageZoom !== 1 || mapping.visualScale !== 1)
    return { unavailable: 'CSS_REFERENCE_REQUIRES_STANDARD_ZOOM' };
  if (
    source.width !== Math.round(viewport.width * viewport.dpr) ||
    source.height !== Math.round(viewport.height * viewport.dpr)
  )
    return { unavailable: 'CSS_REFERENCE_SOURCE_MAPPING_MISMATCH' };
  const widthPx = Math.round(341 * viewport.dpr);
  const heightPx = Math.round(256 * viewport.dpr);
  if (!widthPx || !heightPx || widthPx > 16384 || heightPx > 16384)
    return { unavailable: 'CSS_REFERENCE_FIELD_OUT_OF_RANGE' };
  return {
    field: {
      widthPx,
      heightPx,
      basis: 'W3C_CSS_REFERENCE',
      reference: `W3C Understanding SC 2.3.1 reference: 341x256 CSS pixels at standard browser zoom (1) and visual viewport scale (1), mapped with observed DPR ${viewport.dpr} to ${widthPx}x${heightPx} source pixels. Verified source ${source.width}x${source.height} for CSS viewport ${viewport.width}x${viewport.height}; field extents rounded to nearest source pixel. Actual display geometry/viewing distance and outside-capture areas remain unknown. Reference comparison, not physical calibration or a WCAG verdict. https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html`,
    },
  };
}
