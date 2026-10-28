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

/** Clear debugger emulation for the owned session; failures remain visible to cleanup. */
export async function clearEmulatedViewport(
  tabId: number,
  driver = metricsDriver,
) {
  await driver.command(tabId, 'Emulation.clearDeviceMetricsOverride');
}

/** Restore prior emulation using the captured ownership receipt. */
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
  assertEmulationBounds(expected);
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

/** Resize the captured viewport and verify the observed geometry before continuing. */
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
export { ViewportRestoreDeadline } from './viewport-deadline';
export { waitForStableViewport } from './viewport-settle';

function assertEmulationBounds(expected: PageInventory['viewport']): void {
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
}
