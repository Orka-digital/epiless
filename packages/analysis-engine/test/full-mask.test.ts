import { describe, expect, it } from 'vitest';
import { FrameAnalyzer, combinedMaskFieldAnalysis } from '../src/index.js';

describe('exact full-mask shortcut', () => {
  for (const [width, height, fieldWidth, fieldHeight] of [
    [32, 24, 12, 8],
    [16, 16, 32, 32], // Exactly 25% remains below the strict >25% boundary.
    [19, 17, 341, 256], // Outside the captured image retains its denominator.
    [16, 16, 64, 8], // Only one field axis is larger than the source.
  ]) {
    for (const pattern of ['uniform', 'textured', 'red'] as const) {
      it(`matches the generic mask solver for ${pattern} ${width}x${height} in ${fieldWidth}x${fieldHeight}`, () => {
        const events: string[] = [];
        const analyzer = new FrameAnalyzer({
          visualField: {
            widthPx: fieldWidth,
            heightPx: fieldHeight,
            basis: 'W3C_CSS_REFERENCE',
            reference: 'Explicit test geometry; not physical calibration.',
          },
          onCandidate: (finding) => events.push(finding.id),
        });
        for (let frame = 0; frame < 90; frame++) {
          const rgba = new Uint8Array(width * height * 4);
          const bright = Math.floor(frame / 5) % 2 === 1;
          for (let pixel = 0; pixel < width * height; pixel++) {
            const at = pixel * 4;
            if (pattern === 'red') {
              rgba[at] = bright ? 255 : 0;
              rgba[at + 1] = bright ? 0 : 255;
            } else {
              // Every pixel qualifies, but textured pixels have independent
              // histories. Full-mask evidence must not depend on tile sharing.
              const value =
                (bright ? 220 : 10) +
                (pattern === 'textured' ? (pixel * 13) % 30 : 0);
              rgba[at] = rgba[at + 1] = rgba[at + 2] = value;
            }
            rgba[at + 3] = 255;
          }
          analyzer.pushFrame({
            rgba,
            width,
            height,
            timestampMs: (frame * 1000) / 60,
          });
        }
        const result = analyzer.finish();
        const expected = combinedMaskFieldAnalysis(
          new Uint8Array(width * height).fill(1),
          width,
          height,
          fieldWidth,
          fieldHeight,
        );
        expect(result.findings.map((finding) => finding.type).sort()).toEqual(
          pattern === 'red'
            ? ['GENERAL_FLASH', 'RED_FLASH']
            : ['GENERAL_FLASH'],
        );
        expect(events).toEqual(result.findings.map((finding) => finding.id));
        for (const finding of result.findings) {
          expect(finding.spatial).toMatchObject({
            componentPixels: width * height,
            simultaneousPixels: expected.totalPixels,
            visualField: {
              maximumPixels: expected.maximumPixels,
              maximumRatio: expected.maximumRatio,
              exceedsThreshold: expected.exceedsThreshold,
              window: expected.window,
            },
          });
          expect(finding.diagnostic?.complete).toBe(true);
        }
      });
    }
  }

  it('does not fill a single nonflashing pixel inside an otherwise full component', () => {
    const width = 32,
      height = 24,
      hole = 12 * width + 16;
    const analyzer = new FrameAnalyzer({
      visualField: {
        widthPx: width,
        heightPx: height,
        basis: 'W3C_CSS_REFERENCE',
        reference: 'Explicit test geometry; not physical calibration.',
      },
    });
    for (let frame = 0; frame < 90; frame++) {
      const rgba = new Uint8Array(width * height * 4);
      for (let pixel = 0; pixel < width * height; pixel++) {
        const at = pixel * 4;
        const value = pixel === hole ? 0 : Math.floor(frame / 5) % 2 ? 255 : 0;
        rgba[at] = rgba[at + 1] = rgba[at + 2] = value;
        rgba[at + 3] = 255;
      }
      analyzer.pushFrame({
        rgba,
        width,
        height,
        timestampMs: (frame * 1000) / 60,
      });
    }
    const result = analyzer.finish();
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].spatial).toMatchObject({
      componentPixels: width * height - 1,
      simultaneousPixels: width * height - 1,
      visualField: {
        maximumPixels: width * height - 1,
        maximumRatio: (width * height - 1) / (width * height),
      },
    });
  });
});
