export function rgbaImage(
  w: number,
  h: number,
  color: (x: number, y: number) => number,
): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4,
        v = color(x, y);
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  return rgba;
}

export const field = {
  widthPx: 10,
  heightPx: 10,
  basis: 'EXPLICIT_CALIBRATION' as const,
  reference: 'Synthetic integer field; no display assertion',
};
