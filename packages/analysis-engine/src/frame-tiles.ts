import { dirtyTiles, uniformTile } from './tile-geometry.js';
import { FrameMemory } from './frame-memory.js';
/** Lossless tile sharing owns representative identity and exact state materialization.
 * These inherited fields stay direct properties in pixel loops; no proxies or copied histories. */
export abstract class FrameTiles extends FrameMemory {
  protected prepareTiles(
    rgba: Uint8Array | Uint8ClampedArray,
    changedRuns?: Uint32Array,
  ): void {
    const words =
      rgba.byteOffset % 4 === 0
        ? new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.byteLength / 4)
        : undefined;
    const dirty = dirtyTiles(
      changedRuns,
      this.width,
      this.tileColumns,
      this.tileUniform.length,
    );
    for (let ty = 0; ty < this.height; ty += 8)
      for (let tx = 0; tx < this.width; tx += 8) {
        const tile = (ty >>> 3) * this.tileColumns + (tx >>> 3),
          peer = this.tilePeers[tile];
        if (dirty && !dirty[tile] && (peer < 0 || !dirty[peer])) continue;
        if (peer >= 0) this.updatePeer(words, tx, ty, tile, peer);
        else if (this.tileUniform[tile] !== 2)
          this.updateUniform(rgba, words, tx, ty, tile);
      }
    if (!this.tilesPrepared && words) this.shareInitialTiles(words);
    this.tilesPrepared = true;
  }
  private updatePeer(
    words: Uint32Array | undefined,
    tx: number,
    ty: number,
    tile: number,
    peer: number,
  ): void {
    const seed = ty * this.width + tx;
    const peerSeed =
      Math.floor(peer / this.tileColumns) * 8 * this.width +
      (peer % this.tileColumns) * 8;
    if (words && this.sameTile(words, seed, peerSeed)) {
      if (this.tileUniform[tile] !== this.tileUniform[peer]) {
        this.mapTile(seed, peerSeed);
        this.tileUniform[tile] = this.tileUniform[peer];
      }
    } else {
      // All comparisons/splits precede transition updates, so these are
      // the exact previous histories even when the peer changes too.
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const pixel = seed + y * this.width + x;
          this.copyPixelState(this.representatives[pixel], pixel);
          this.representatives[pixel] = pixel;
        }
      this.tilePeers[tile] = -1;
      this.tileDependents[peer]--;
      this.representativeCount += 64;
      this.tileUniform[tile] = 2;
    }
  }
  private updateUniform(
    rgba: Uint8Array | Uint8ClampedArray,
    words: Uint32Array | undefined,
    tx: number,
    ty: number,
    tile: number,
  ): void {
    const seed = ty * this.width + tx;
    const right = Math.min(tx + 8, this.width),
      bottom = Math.min(ty + 8, this.height);
    const equal = uniformTile(
      rgba,
      words,
      this.width,
      tx,
      ty,
      right,
      bottom,
      seed,
    );
    if (equal) {
      if (!this.tileUniform[tile]) {
        this.tileUniform[tile] = 1;
        this.representativeCount -= (right - tx) * (bottom - ty) - 1;
        for (let y = ty; y < bottom; y++)
          this.representatives.fill(
            seed,
            y * this.width + tx,
            y * this.width + right,
          );
      }
      return;
    }
    const shared = this.tileUniform[tile] === 1;
    this.tileUniform[tile] = 2;
    if (shared) this.representativeCount += (right - tx) * (bottom - ty) - 1;
    if (!shared) return;
    for (let y = ty; y < bottom; y++)
      for (let x = tx; x < right; x++) {
        const pixel = y * this.width + x;
        this.representatives[pixel] = pixel;
        if (pixel !== seed) this.copyPixelState(seed, pixel);
      }
  }
  protected sameTile(
    words: Uint32Array,
    first: number,
    second: number,
  ): boolean {
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        if (
          words[first + y * this.width + x] !==
          words[second + y * this.width + x]
        )
          return false;
    return true;
  }
  protected mapTile(seed: number, peerSeed: number): void {
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        this.representatives[seed + y * this.width + x] =
          this.representatives[peerSeed + y * this.width + x];
  }
  protected shareInitialTiles(words: Uint32Array): void {
    // Hashes only select candidates. All 64 RGBA pixels must match exactly.
    // At most eight canonical candidates per hash bound collision work; an
    // unshared tile retains full per-pixel processing. No later re-coalescing.
    for (let ty = 0; ty + 8 <= this.height; ty += 8)
      for (let tx = 0; tx + 8 <= this.width; tx += 8) {
        const seed = ty * this.width + tx,
          tile = (ty >>> 3) * this.tileColumns + (tx >>> 3);
        let hash = 2166136261;
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x++)
            hash = Math.imul(hash ^ words[seed + y * this.width + x], 16777619);
        const bucket = (hash ^ (hash >>> 16)) & 4095;
        const count = this.tileCandidateCounts[bucket];
        let peer = -1;
        for (let index = 0; index < count; index++) {
          const candidate = this.tileCandidates[bucket * 8 + index];
          const peerSeed =
            Math.floor(candidate / this.tileColumns) * 8 * this.width +
            (candidate % this.tileColumns) * 8;
          if (this.sameTile(words, seed, peerSeed)) {
            peer = candidate;
            this.mapTile(seed, peerSeed);
            break;
          }
        }
        if (peer >= 0) {
          this.representativeCount -= this.tileUniform[tile] === 1 ? 1 : 64;
          this.tilePeers[tile] = peer;
          this.tileDependents[peer]++;
          this.tileUniform[tile] = this.tileUniform[peer];
        } else if (count < 8) {
          this.tileCandidates[bucket * 8 + count] = tile;
          this.tileCandidateCounts[bucket]++;
        }
      }
  }
  protected copyPixelState(from: number, to: number): void {
    for (let i = 0; i < 7; i++)
      this.general.starts[to * 7 + i] = this.general.starts[from * 7 + i];
    this.general.count[to] = this.general.count[from];
    this.general.next[to] = this.general.next[from];
    for (let i = 0; i < 3; i++) {
      this.red.starts[to * 3 + i] = this.red.starts[from * 3 + i];
      this.red.previous[to * 3 + i] = this.red.previous[from * 3 + i];
    }
    this.red.tripleEndingPrevious[to] = this.red.tripleEndingPrevious[from];
    this.red.candidateStarts[to] = this.red.candidateStarts[from];
    this.luminance[to] = this.luminance[from];
    this.direction[to] = this.direction[from];
    this.redAnchor[to] = this.redAnchor[from];
    this.saturated[to] = this.saturated[from];
    this.redPending[to] = this.redPending[from];
    this.redDu[to] = this.redDu[from];
    this.redDv[to] = this.redDv[from];
    this.redStart[to] = this.redStart[from];
    this.previousRgb[to] = this.previousRgb[from];
  }
}
