import type { PageInventory } from './model';

import { sameViewport } from './scenario-plan';
import { ViewportRestoreDeadline } from './viewport-deadline';

class ViewportSettleError extends Error {
  constructor(
    expected: PageInventory['viewport'] | undefined,
    reached: PageInventory['viewport'] | undefined,
    readonly canRebind = false,
    readonly lastMatchedExpected = false,
  ) {
    super(
      expected
        ? `VIEWPORT_RESTORE_GEOMETRY_UNCONFIRMED: expected ${JSON.stringify(expected)}, reached ${JSON.stringify(reached)}`
        : 'VIEWPORT_DID_NOT_SETTLE',
    );
  }
}

/** Observe actual CSS geometry settling after browser chrome or source changes.
 * Repeated equality, not a fixed sleep or successful CDP command, is the gate. */
export async function waitForStableViewport(options: {
  read(): Promise<PageInventory['viewport']>;
  wait(ms: number): Promise<void>;
  guard?(): Promise<unknown>;
  expected?: PageInventory['viewport'];
  /** Default3s. Terminal debugger chrome can remain for5s after detach. */
  timeoutMs?: number;
  deadline?: ViewportRestoreDeadline;
  /** Optional poll admission margin; never extends an operation's deadline. */
  reserveCycleMs?: number;
}): Promise<PageInventory['viewport']> {
  const timeoutMs = options.timeoutMs ?? 3000;
  const reserveCycleMs = options.reserveCycleMs ?? 0;
  assertSettleBounds(timeoutMs, reserveCycleMs);
  const deadline = Math.min(
    performance.now() + timeoutMs,
    options.deadline?.expiresAt ?? Infinity,
  );
  const expired = Symbol('viewport-settle-deadline');
  // The deadline bounds slow browser replies as well as the nominal poll delay.
  // The sample cap also bounds immediately resolving mocked/failed schedulers.
  const sampleLimit = Math.ceil(timeoutMs / 100);
  let interruptedContextRead = false;
  let invalidGeometry = false;
  let mismatchSamples = 0;
  const withinDeadline = async <T>(
    operation: () => Promise<T>,
    kind: 'context' | 'wait' = 'context',
  ): Promise<T> => {
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      if (kind === 'context') interruptedContextRead = true;
      throw expired;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(expired), Math.ceil(remaining));
        }),
      ]);
      // A browser reply can settle after its deadline while its timer is delayed.
      // Never let that late reply start another read, wait, or success path.
      if (performance.now() >= deadline) throw expired;
      return result;
    } catch (error) {
      if (error === expired && kind === 'context')
        interruptedContextRead = true;
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  let previous: PageInventory['viewport'] | undefined;
  let stable = 0;
  try {
    for (let attempt = 0; attempt < sampleLimit; attempt++) {
      // Do not launch a new guarded read with less than one poll interval left.
      // Only fully completed samples may authorize a later fallback; a read
      // already in flight remains strictly subject to its original deadline.
      if (reserveCycleMs > 0 && deadline - performance.now() < reserveCycleMs)
        break;
      if (options.guard) await withinDeadline(options.guard);
      const viewport = await withinDeadline(options.read);
      if (options.guard) await withinDeadline(options.guard);
      const valid = validViewport(viewport);
      if (!valid) invalidGeometry = true;
      if (
        valid &&
        options.expected &&
        !sameViewport(options.expected, viewport)
      )
        mismatchSamples++;
      stable = nextStableCount(
        valid,
        options.expected,
        viewport,
        previous,
        stable,
      );
      if (stable >= 3) return viewport;
      previous = viewport;
      if (attempt + 1 < sampleLimit)
        await withinDeadline(
          () =>
            options.wait(
              Math.min(100, Math.max(0, deadline - performance.now())),
            ),
          'wait',
        );
    }
  } catch (error) {
    if (error !== expired) throw error;
  }
  throwSettleFailure(
    options.expected,
    previous,
    interruptedContextRead,
    invalidGeometry,
    mismatchSamples,
  );
}

function validViewport(viewport: PageInventory['viewport']): boolean {
  return (
    [viewport.width, viewport.height].every(
      (n) => Number.isInteger(n) && n > 0 && n <= 16384,
    ) &&
    Number.isFinite(viewport.dpr) &&
    viewport.dpr > 0 &&
    viewport.dpr <= 16
  );
}

function nextStableCount(
  valid: boolean,
  expected: PageInventory['viewport'] | undefined,
  viewport: PageInventory['viewport'],
  previous: PageInventory['viewport'] | undefined,
  stable: number,
): number {
  return valid && (!expected || sameViewport(expected, viewport))
    ? previous && sameViewport(previous, viewport)
      ? stable + 1
      : 1
    : 0;
}

function assertSettleBounds(timeoutMs: number, reserveCycleMs: number): void {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 7000)
    throw new Error('VIEWPORT_SETTLE_TIMEOUT_OUTSIDE_BOUNDS');
  if (
    !Number.isInteger(reserveCycleMs) ||
    reserveCycleMs < 0 ||
    reserveCycleMs > 100
  )
    throw new Error('VIEWPORT_SETTLE_CYCLE_RESERVE_OUTSIDE_BOUNDS');
}

function throwSettleFailure(
  expected: PageInventory['viewport'] | undefined,
  previous: PageInventory['viewport'] | undefined,
  interruptedContextRead: boolean,
  invalidGeometry: boolean,
  mismatchSamples: number,
): never {
  const completeContext = !interruptedContextRead && !invalidGeometry;
  const lastMatchedExpected =
    completeContext &&
    !!expected &&
    !!previous &&
    sameViewport(expected, previous);
  throw new ViewportSettleError(
    expected,
    previous,
    completeContext && !lastMatchedExpected && mismatchSamples >= 3,
    lastMatchedExpected,
  );
}
