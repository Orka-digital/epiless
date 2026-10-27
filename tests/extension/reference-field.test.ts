import { describe, expect, it } from 'vitest';
import { cssReferenceField } from '../../apps/chrome-extension/src/reference-field';

describe('CSS reference mapping', () => {
  it('keeps the same CSS field and affected fraction across DPR 1 and 2', () => {
    const fields = [1, 2].map(
      (dpr) =>
        cssReferenceField(
          { width: 900 * dpr, height: 560 * dpr },
          {
            viewport: { width: 900, height: 560, dpr },
            pageZoom: 1,
            visualScale: 1,
          },
        ).field!,
    );
    expect(fields.map((f) => [f.basis, f.widthPx, f.heightPx])).toEqual([
      ['W3C_CSS_REFERENCE', 341, 256],
      ['W3C_CSS_REFERENCE', 682, 512],
    ]);
    expect(12000 / (fields[0].widthPx * fields[0].heightPx)).toBe(
      (12000 * 4) / (fields[1].widthPx * fields[1].heightPx),
    );
  });

  it('maps fractional DPR with explicit source-pixel rounding', () => {
    const result = cssReferenceField(
      { width: 1126, height: 701 },
      {
        viewport: { width: 901, height: 561, dpr: 1.25 },
        pageZoom: 1,
        visualScale: 1,
      },
    );
    expect(result.field?.widthPx).toBe(426);
    expect(result.field?.heightPx).toBe(320);
    expect(result.field?.reference).toContain(
      'rounded to nearest source pixel',
    );
  });

  it.each([0.5, 1.25, 2])(
    'refuses nonstandard browser zoom %s rather than compensating for enlarged content',
    (pageZoom) => {
      expect(
        cssReferenceField(
          { width: 1800, height: 1120 },
          {
            viewport: { width: 900, height: 560, dpr: 2 },
            pageZoom,
            visualScale: 1,
          },
        ),
      ).toEqual({ unavailable: 'CSS_REFERENCE_REQUIRES_STANDARD_ZOOM' });
    },
  );

  it('refuses pinch zoom, missing mapping and mismatched source geometry', () => {
    const mapping = {
      viewport: { width: 900, height: 560, dpr: 2 },
      pageZoom: 1,
      visualScale: 1,
    };
    expect(
      cssReferenceField(
        { width: 1800, height: 1120 },
        { ...mapping, visualScale: 1.5 },
      ).field,
    ).toBeUndefined();
    expect(
      cssReferenceField({ width: 1800, height: 1120 }, undefined).field,
    ).toBeUndefined();
    expect(cssReferenceField({ width: 1799, height: 1120 }, mapping)).toEqual({
      unavailable: 'CSS_REFERENCE_SOURCE_MAPPING_MISMATCH',
    });
  });
});
