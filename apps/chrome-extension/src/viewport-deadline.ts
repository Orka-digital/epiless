/** One monotone budget shared by terminal restore phases. A timed-out browser
 * request is not cancelled, so callers must never start a parallel rescue. */
export class ViewportRestoreDeadline {
  readonly expiresAt: number;
  readonly expiresEpochMs: number;
  constructor(timeoutMs = 10_000) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10_000)
      throw new Error('VIEWPORT_RESTORE_DEADLINE_OUTSIDE_BOUNDS');
    this.expiresAt = performance.now() + timeoutMs;
    this.expiresEpochMs = Date.now() + timeoutMs;
  }
  remaining(): number {
    return Math.max(0, this.expiresAt - performance.now());
  }
  async run<T>(action: () => Promise<T>): Promise<T> {
    const remaining = this.remaining();
    if (remaining <= 0) throw new Error('VIEWPORT_RESTORE_DEADLINE');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        action(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('VIEWPORT_RESTORE_DEADLINE')),
            Math.ceil(remaining),
          );
        }),
      ]);
      if (this.remaining() <= 0) throw new Error('VIEWPORT_RESTORE_DEADLINE');
      return value;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
