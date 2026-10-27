import type { ReplayTarget } from './model';

export interface PointerResult {
  achieved: boolean;
  reason?: string;
  state?: string;
}
interface PointerProbe extends PointerResult {
  x?: number;
  y?: number;
}
export interface PointerDriver {
  targets(): Promise<{ tabId?: number; attached: boolean }[]>;
  attach(tabId: number): Promise<void>;
  move(tabId: number, x: number, y: number): Promise<void>;
  detach(tabId: number): Promise<void>;
}
const chromePointerDriver: PointerDriver = {
  targets: () => chrome.debugger.getTargets(),
  attach: (tabId) => chrome.debugger.attach({ tabId }, '1.3'),
  move: async (tabId, x, y) => {
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
      pointerType: 'mouse',
    });
  },
  detach: (tabId) => chrome.debugger.detach({ tabId }),
};
export async function attachPointerSession(
  tabId: number,
  driver = chromePointerDriver,
) {
  if (
    (await driver.targets()).some(
      (target) => target.tabId === tabId && target.attached,
    )
  )
    throw new Error('DEBUGGER_ALREADY_ATTACHED');
  await driver.attach(tabId);
}
export async function detachPointerSession(
  tabId: number,
  driver = chromePointerDriver,
) {
  await driver.detach(tabId).catch(() => undefined);
}

/** Terminal cleanup cannot infer release from a swallowed detach error. Chrome
 * only permits detaching this extension's attachment; a foreign debugger stays
 * untouched and leaves the result explicitly unconfirmed. */
export async function detachPointerSessionAndConfirm(
  tabId: number,
  driver = chromePointerDriver,
) {
  await detachPointerSession(tabId, driver);
  if (
    (await driver.targets()).some(
      (target) => target.tabId === tabId && target.attached,
    )
  )
    throw new Error('DEBUGGER_RELEASE_UNCONFIRMED');
}

/** Keep ownership recoverable until both native release and persistent cleanup
 * succeed. Suppression is separate from ownership, including authorization abort. */
export async function releaseOwnedPointerSession<
  T extends { tabId: number; generation: string },
>(options: {
  session: T;
  current(): T | undefined;
  intentional: Set<T>;
  forget(): Promise<void>;
  driver?: PointerDriver;
}): Promise<void> {
  if (options.current() !== options.session)
    throw new Error('DEBUGGER_RELEASE_OWNERSHIP_CHANGED');
  options.intentional.add(options.session);
  try {
    await detachPointerSessionAndConfirm(options.session.tabId, options.driver);
    if (options.current() !== options.session)
      throw new Error('DEBUGGER_RELEASE_OWNERSHIP_CHANGED');
    await options.forget();
  } finally {
    options.intentional.delete(options.session);
  }
}

/** Genuine browser pointer input, available only in the explicit advanced build. */
export async function trustedHover(options: {
  enabled: boolean;
  tabId: number;
  target: ReplayTarget;
  guard(): Promise<unknown>;
  request(type: string, target: ReplayTarget): Promise<PointerProbe>;
  driver?: PointerDriver;
  /** Only a live job-owned attachment, never an arbitrary existing debugger. */
  ownsDebuggerSession?: boolean;
}): Promise<PointerResult> {
  if (!options.enabled)
    return { achieved: false, reason: 'TRUSTED_POINTER_DRIVER_NOT_ENABLED' };
  const driver = options.driver ?? chromePointerDriver;
  let attached = false;
  try {
    await options.guard();
    if (
      !options.ownsDebuggerSession &&
      (await driver.targets()).some(
        (target) => target.tabId === options.tabId && target.attached,
      )
    )
      return { achieved: false, reason: 'DEBUGGER_ALREADY_ATTACHED' };
    const probe = await options.request('FG_POINTER_TARGET', options.target);
    if (
      !probe.achieved ||
      !Number.isFinite(probe.x) ||
      !Number.isFinite(probe.y)
    )
      return {
        achieved: false,
        reason: probe.reason ?? 'POINTER_TARGET_UNREACHED',
      };
    await options.guard();
    if (!options.ownsDebuggerSession) {
      await driver.attach(options.tabId);
      attached = true;
    }
    // Re-probe after attaching: DevTools UI or page handlers can change geometry.
    const current = await options.request('FG_POINTER_TARGET', options.target);
    if (
      !current.achieved ||
      !Number.isFinite(current.x) ||
      !Number.isFinite(current.y)
    )
      return {
        achieved: false,
        reason: current.reason ?? 'POINTER_TARGET_CHANGED',
      };
    await options.guard();
    await driver.move(options.tabId, current.x!, current.y!);
    await options.guard();
    return await options.request('FG_POINTER_CONFIRM', options.target);
  } catch (error) {
    return {
      achieved: false,
      reason: `TRUSTED_POINTER_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    if (attached) await driver.detach(options.tabId).catch(() => undefined);
  }
}
