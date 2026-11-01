import {
  OpposingPairHistory,
  TransitionHistory,
} from './transition-history.js';
interface ActiveTileState {
  width: number;
  height: number;
  representativeCount: number;
  representatives: Uint32Array;
  tileColumns: number;
  tileUniform: Uint8Array;
  tileDependents: Uint32Array;
}
/** Expand qualifying representatives into exact source-pixel masks; sparse independent pixels skip a full image walk. */
export function expandActiveTiles(
  history: TransitionHistory | OpposingPairHistory,
  state: ActiveTileState,
): void {
  if (!history.hasActive) return;
  history.activeCount = 0;
  history.earliestActive = Infinity;
  history.firstActive = Infinity;
  history.lastActive = -1;
  if (state.representativeCount === 1) {
    // Every source pixel has the exact history of pixel zero. A qualifying
    // representative therefore means an exact full active mask, not a box
    // approximation or a count inferred from the current colour alone.
    history.active.fill(1);
    history.activeCount = state.width * state.height;
    history.firstActive = 0;
    history.lastActive = history.activeCount - 1;
    history.earliestActive = history.started(0);
    return;
  }
  let independent = history.activeSeedCount <= history.activeSeeds.length;
  for (let index = 0; independent && index < history.activeSeedCount; index++) {
    const pixel = history.activeSeeds[index],
      tile =
        (Math.floor(pixel / state.width) >>> 3) * state.tileColumns +
        ((pixel % state.width) >>> 3);
    independent =
      state.tileUniform[tile] === 2 && state.tileDependents[tile] === 0;
  }
  if (independent) {
    // Every active representative has exactly one source pixel. There are no
    // aliases to expand; do not scan two million unrelated pixels for one dot.
    history.activeCount = history.activeSeedCount;
    for (let index = 0; index < history.activeSeedCount; index++) {
      const pixel = history.activeSeeds[index];
      history.firstActive = Math.min(history.firstActive, pixel);
      history.lastActive = Math.max(history.lastActive, pixel);
      history.earliestActive = Math.min(
        history.earliestActive,
        history.started(pixel),
      );
    }
    return;
  }
  for (let pixel = 0; pixel < state.width * state.height; pixel++) {
    if (state.representatives[pixel] !== pixel)
      history.active[pixel] = history.active[state.representatives[pixel]];
    if (history.active[pixel]) {
      if (!history.activeCount) history.firstActive = pixel;
      history.lastActive = pixel;
      history.activeCount++;
      if (state.representatives[pixel] === pixel)
        history.earliestActive = Math.min(
          history.earliestActive,
          history.started(pixel),
        );
    }
  }
}
