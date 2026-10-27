import type { PageInventory } from './model';
import { sameViewport } from './scenario-plan';

export interface MetricsDriver {
  command(
    tabId: number,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown>;
}
const metricsDriver: MetricsDriver = {
  command: (tabId, method, params) =>
    chrome.debugger.sendCommand({ tabId }, method, params),
};

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
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 7000)
    throw new Error('VIEWPORT_SETTLE_TIMEOUT_OUTSIDE_BOUNDS');
  const reserveCycleMs = options.reserveCycleMs ?? 0;
  if (
    !Number.isInteger(reserveCycleMs) ||
    reserveCycleMs < 0 ||
    reserveCycleMs > 100
  )
    throw new Error('VIEWPORT_SETTLE_CYCLE_RESERVE_OUTSIDE_BOUNDS');
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
      const valid =
        [viewport.width, viewport.height].every(
          (n) => Number.isInteger(n) && n > 0 && n <= 16384,
        ) &&
        Number.isFinite(viewport.dpr) &&
        viewport.dpr > 0 &&
        viewport.dpr <= 16;
      if (!valid) invalidGeometry = true;
      if (
        valid &&
        options.expected &&
        !sameViewport(options.expected, viewport)
      )
        mismatchSamples++;
      stable =
        valid && (!options.expected || sameViewport(options.expected, viewport))
          ? previous && sameViewport(previous, viewport)
            ? stable + 1
            : 1
          : 0;
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
  const completeContext = !interruptedContextRead && !invalidGeometry;
  const lastMatchedExpected =
    completeContext &&
    !!options.expected &&
    !!previous &&
    sameViewport(options.expected, previous);
  throw new ViewportSettleError(
    options.expected,
    previous,
    completeContext && !lastMatchedExpected && mismatchSamples >= 3,
    lastMatchedExpected,
  );
}
export async function clearEmulatedViewport(
  tabId: number,
  driver = metricsDriver,
) {
  await driver.command(tabId, 'Emulation.clearDeviceMetricsOverride');
}
export async function restoreEmulatedViewport(
  tabId: number,
  _original: PageInventory['viewport'],
  driver = metricsDriver,
) {
  await clearEmulatedViewport(tabId, driver);
}

/** Legacy CSS-only driver. Production compact capture rejects this method:
 * native pixel mapping was disproven even when its DOM dimensions matched. */
export async function emulateCapturedViewport(options: {
  tabId: number;
  expected: PageInventory['viewport'];
  read(): Promise<PageInventory>;
  guard(): Promise<unknown>;
  wait(route: string): Promise<void>;
  remember(viewport: PageInventory['viewport']): void;
  driver?: MetricsDriver;
}): Promise<PageInventory> {
  const expected = options.expected;
  if (
    !Number.isInteger(expected.width) ||
    !Number.isInteger(expected.height) ||
    expected.width < 320 ||
    expected.width > 2400 ||
    expected.height < 240 ||
    expected.height > 1800 ||
    !Number.isFinite(expected.dpr) ||
    expected.dpr <= 0 ||
    expected.dpr > 4
  )
    throw new Error('CDP_VIEWPORT_OUTSIDE_SUPPORTED_BOUNDS');
  const driver = options.driver ?? metricsDriver;
  await options.guard();
  const before = await options.read();
  if (Math.abs(before.viewport.dpr - expected.dpr) >= 0.001)
    throw new Error('VIEWPORT_DPR_MISMATCH');
  options.remember({ ...before.viewport });
  await options.guard();
  await driver.command(options.tabId, 'Emulation.setDeviceMetricsOverride', {
    width: expected.width,
    height: expected.height,
    deviceScaleFactor: expected.dpr,
    mobile: false,
    scale: 1,
    dontSetVisibleSize: true,
  });
  await options.wait(before.url);
  const reached = await options.read();
  const result = (await driver.command(
    options.tabId,
    'Page.getLayoutMetrics',
  )) as
    | {
        cssVisualViewport?: {
          clientWidth?: number;
          clientHeight?: number;
          scale?: number;
          offsetX?: number;
          offsetY?: number;
        };
      }
    | undefined;
  const visual = result?.cssVisualViewport;
  // Scrollbars can reduce clientWidth; the external renderer extent is verified
  // separately against the raw captured frame before pixels are attributed.
  if (
    !sameViewport(expected, reached.viewport) ||
    !visual ||
    visual.scale !== 1 ||
    visual.offsetX !== 0 ||
    visual.offsetY !== 0 ||
    !Number.isFinite(visual.clientWidth) ||
    !Number.isFinite(visual.clientHeight) ||
    visual.clientWidth! < expected.width - 32 ||
    visual.clientWidth! > expected.width ||
    visual.clientHeight! < expected.height - 32 ||
    visual.clientHeight! > expected.height
  )
    throw new Error('CDP_VIEWPORT_GEOMETRY_NOT_CONFIRMED');
  return reached;
}

export interface WindowGeometry {
  id: number;
  width: number;
  height: number;
  left?: number;
  top?: number;
}
export async function resizeCapturedViewport(options: {
  tabId: number;
  expected: PageInventory['viewport'];
  read(): Promise<PageInventory>;
  guard(): Promise<unknown>;
  wait(route: string): Promise<void>;
  remember(window: WindowGeometry): void;
}): Promise<PageInventory> {
  await options.guard();
  const tab = await chrome.tabs.get(options.tabId);
  const win = await chrome.windows.get(tab.windowId);
  if (
    win.type !== 'normal' ||
    win.state !== 'normal' ||
    !win.width ||
    !win.height ||
    win.id === undefined
  )
    throw new Error('VIEWPORT_RESIZE_REQUIRES_NORMAL_WINDOW');
  const before = await options.read();
  if (Math.abs(before.viewport.dpr - options.expected.dpr) >= 0.001)
    throw new Error('VIEWPORT_DPR_MISMATCH');
  options.remember({
    id: win.id,
    width: win.width,
    height: win.height,
    left: win.left,
    top: win.top,
  });
  await options.guard();
  await chrome.windows.update(win.id, {
    width: Math.max(
      400,
      Math.min(
        2400,
        Math.round(win.width + options.expected.width - before.viewport.width),
      ),
    ),
    height: Math.max(
      300,
      Math.min(
        1800,
        Math.round(
          win.height + options.expected.height - before.viewport.height,
        ),
      ),
    ),
  });
  await options.wait(before.url);
  const reached = await options.read();
  if (!sameViewport(options.expected, reached.viewport))
    throw new Error(
      `VIEWPORT_GEOMETRY_NOT_REACHED: requested ${options.expected.width}x${options.expected.height}@${options.expected.dpr}, reached ${reached.viewport.width}x${reached.viewport.height}@${reached.viewport.dpr}`,
    );
  return reached;
}
