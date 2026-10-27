/** Source timestamps have an arbitrary origin. Never treat them as performance.now() or epoch.
 * These are frame RECEIPT observations, not a measurement of compositor/capture latency. */
export class SourceFrameClock {
  private frames: { sourceMs: number; receiptEpochMs: number }[] = [];

  reset(): void {
    this.frames = [];
  }

  add(sourceMs: number, receiptEpochMs: number): boolean {
    if (![sourceMs, receiptEpochMs].every((n) => Number.isFinite(n) && n >= 0))
      return false;
    const previous = this.frames.at(-1);
    if (
      previous &&
      (sourceMs <= previous.sourceMs ||
        receiptEpochMs < previous.receiptEpochMs)
    )
      return false;
    this.frames.push({ sourceMs, receiptEpochMs });
    this.frames = this.frames
      .filter((frame) => frame.sourceMs >= sourceMs - 6_000)
      .slice(-360);
    return true;
  }

  resolve(startSourceMs: number, endSourceMs: number) {
    if (
      ![startSourceMs, endSourceMs].every(
        (n) => Number.isFinite(n) && n >= 0,
      ) ||
      endSourceMs < startSourceMs ||
      endSourceMs - startSourceMs > 2_000
    )
      return;
    // Match recorded frames only. A long stall is not filled with invented clock samples.
    const nearest = (sourceMs: number) =>
      this.frames.reduce<(typeof this.frames)[number] | undefined>(
        (best, frame) =>
          !best ||
          Math.abs(frame.sourceMs - sourceMs) <
            Math.abs(best.sourceMs - sourceMs)
            ? frame
            : best,
        undefined,
      );
    const start = nearest(startSourceMs),
      end = nearest(endSourceMs);
    if (!start || !end) return;
    const startError = Math.abs(start.sourceMs - startSourceMs);
    const endError = Math.abs(end.sourceMs - endSourceMs);
    if (
      startError > 50 ||
      endError > 50 ||
      end.sourceMs < start.sourceMs ||
      end.receiptEpochMs - start.receiptEpochMs > 2_000
    )
      return;
    const frames = this.frames.filter(
      (frame) =>
        frame.sourceMs >= start.sourceMs && frame.sourceMs <= end.sourceMs,
    );
    const offsets = frames.map(
      (frame) => frame.receiptEpochMs - frame.sourceMs,
    );
    return {
      windowStartEpochMs: start.receiptEpochMs,
      windowEndEpochMs: end.receiptEpochMs,
      clockBasis: 'FRAME_RECEIPT_ESTIMATE' as const,
      alignmentUncertaintyMs: null,
      frameClock: {
        method: 'PER_FRAME_RECEIPT' as const,
        matchedFrames: frames.length,
        receiptOffsetSpreadMs: Math.max(...offsets) - Math.min(...offsets),
        startBoundaryErrorMs: startError,
        endBoundaryErrorMs: endError,
      },
    };
  }
}
