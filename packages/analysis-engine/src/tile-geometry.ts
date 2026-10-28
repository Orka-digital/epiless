/** Mark tiles touched by exact changed runs; undefined means every tile must be examined. */
export function dirtyTiles(
  changedRuns: Uint32Array | undefined,
  width: number,
  tileColumns: number,
  tileCount: number,
): Uint8Array | undefined {
  let dirty: Uint8Array | undefined;
  if (changedRuns && changedRuns.length < 192) {
    dirty = new Uint8Array(tileCount);
    for (let i = 0; i < changedRuns.length; i += 3) {
      let p = changedRuns[i];
      const end = changedRuns[i + 1];
      while (p < end) {
        const row = Math.floor(p / width),
          x = p % width,
          last = Math.min(width - 1, end - 1 - row * width);
        for (let tx = x >>> 3; tx <= last >>> 3; tx++)
          dirty[(row >>> 3) * tileColumns + tx] = 1;
        p = (row + 1) * width;
      }
    }
  }
  return dirty;
}
/** Compare every RGBA value in a tile, including partial edge tiles and unaligned byte views. */
export function uniformTile(
  rgba: Uint8Array | Uint8ClampedArray,
  words: Uint32Array | undefined,
  width: number,
  tx: number,
  ty: number,
  right: number,
  bottom: number,
  seed: number,
): boolean {
  const offset = seed * 4;
  let equal = true;
  outer: for (let y = ty; y < bottom; y++)
    for (let x = tx; x < right; x++) {
      const i = (y * width + x) * 4;
      if (
        words
          ? words[i / 4] !== words[seed]
          : rgba[i] !== rgba[offset] ||
            rgba[i + 1] !== rgba[offset + 1] ||
            rgba[i + 2] !== rgba[offset + 2] ||
            rgba[i + 3] !== rgba[offset + 3]
      ) {
        equal = false;
        break outer;
      }
    }
  return equal;
}
