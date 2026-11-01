import { planRoute } from '@epi-less/core';

import type { StartOptions } from './command-protocol';

import {
  createDisposableScan,
  validOwnedStart,
  type DisposableScanOwner,
} from './disposable-scan';

import { viewportDuration } from './model';

import type {
  AdvancedDependencies,
  AdvancedServices,
} from './runner-advanced-services';
/** Prepare and validate a disposable tab under the original source authorization. */
export function createAdvancedPreparation(
  services: AdvancedServices,
  dependencies: Pick<
    AdvancedDependencies,
    | 'loadAdvancedOwner'
    | 'readOriginalContext'
    | 'persistAdvancedOwner'
    | 'assertOriginalSource'
  >,
) {
  async function prepareAdvancedScan(
    message: StartOptions,
    route?: string,
    allowInactiveSource = false,
  ) {
    if (
      services.execution.preparingAdvanced ||
      services.execution.running ||
      services.execution.authorizing
    )
      throw new Error(
        'Rond de bestaande geavanceerde voorbereiding of scan eerst af.',
      );
    const releasePreparation = services.execution.beginPreparation();
    try {
      if (await dependencies.loadAdvancedOwner())
        throw new Error(
          'Rond de bestaande geavanceerde voorbereiding of scan eerst af.',
        );
      if (!chrome.runtime.getManifest().permissions?.includes('debugger'))
        throw new Error(
          'Deze extensie ondersteunt geen geavanceerde pointermeting.',
        );
      const source = await chrome.tabs.get(message.tabId);
      assertPreparationSource(source);
      const url = new URL(source.url);
      const destination = route ?? source.url;
      const decision = planRoute({
        candidate: destination,
        baseUrl: source.url,
        origin: url.origin,
        depth: 0,
      });
      if (
        !decision.allowed ||
        !decision.url ||
        new URL(destination).origin !== url.origin
      )
        throw new Error(
          'De geavanceerde scan vereist een veilige pagina op dezelfde oorsprong.',
        );
      if (
        !(await chrome.permissions.contains({ origins: [`${url.origin}/*`] }))
      )
        throw new Error('Sitetoestemming ontbreekt.');
      const window = await chrome.windows.get(source.windowId);
      const foreground = (
        await chrome.tabs.query({ active: true, windowId: source.windowId })
      )[0];
      assertPreparationWindow(
        window,
        foreground,
        source.id,
        allowInactiveSource,
      );
      await chrome.scripting.executeScript({
        target: { tabId: source.id },
        files: ['content.js'],
      });
      const context = await dependencies.readOriginalContext(source.id);
      const mode =
        message.mode === 'QUICK'
          ? 'QUICK'
          : message.mode === 'EXTENDED'
            ? 'EXTENDED'
            : 'AUTONOMOUS';
      const owner: DisposableScanOwner = {
        version: 1,
        nonce: crypto.randomUUID(),
        phase: 'CREATE_INTENT',
        createdAt: Date.now(),
        source: {
          tabId: source.id,
          windowId: source.windowId,
          index: source.index,
          url: source.url,
          context,
          window: {
            width: window.width,
            height: window.height,
            left: window.left,
            top: window.top,
          },
        },
        foreground: { tabId: foreground.id!, windowId: source.windowId },
        route: destination,
        mode,
        viewportSeconds: viewportDuration(mode, message.viewportSeconds) / 1000,
        ...(message.replayOf ? { replayOf: message.replayOf } : {}),
      };
      const prepared = await createDisposableScan({
        owner,
        load: dependencies.loadAdvancedOwner,
        persist: dependencies.persistAdvancedOwner,
        create: async () => {
          await dependencies.assertOriginalSource(owner);
          const currentForeground = (
            await chrome.tabs.query({ active: true, windowId: source.windowId })
          )[0];
          if (
            !(await chrome.windows.get(source.windowId)).focused ||
            currentForeground?.id !== foreground.id
          )
            throw new Error('ADVANCED_PREPARE_FOREGROUND_CHANGED');
          const tab = await chrome.tabs.create({
            windowId: source.windowId,
            index: source.index + 1,
            openerTabId: source.id,
            url: destination,
            active: true,
          });
          if (tab.id === undefined)
            throw new Error('ADVANCED_CREATE_RECEIPT_MISSING');
          return { tabId: tab.id, windowId: tab.windowId };
        },
      });
      if (prepared.phase !== 'PREPARED' || prepared.scanTabId === undefined)
        throw new Error(
          prepared.reason ?? 'ADVANCED_PREPARATION_REQUIRES_MANUAL_REVIEW',
        );
      await chrome.action.setBadgeText({
        tabId: prepared.scanTabId,
        text: 'START',
      });
      return { tabId: prepared.scanTabId };
    } finally {
      releasePreparation();
    }
  }

  async function validateAdvancedStart(
    message: StartOptions,
    resume = false,
  ): Promise<DisposableScanOwner> {
    const owner = await dependencies.loadAdvancedOwner();
    const tab = await chrome.tabs.get(message.tabId);
    if (
      !validOwnedStart(owner, {
        tabId: message.tabId,
        url: tab.url ?? '',
        mode: message.mode ?? 'AUTONOMOUS',
        viewportSeconds:
          viewportDuration(
            message.mode ?? 'AUTONOMOUS',
            message.viewportSeconds,
          ) / 1000,
        replayOf: message.replayOf,
      }) ||
      owner!.phase !== (resume ? 'PAUSED' : 'PREPARED')
    )
      throw new Error(
        'Bereid eerst een apart geavanceerd scantabblad voor en start daar via de toolbar.',
      );
    await dependencies.assertOriginalSource(owner!);
    const window = await chrome.windows.get(tab.windowId);
    if (
      !tab.active ||
      tab.pinned ||
      tab.groupId !== -1 ||
      tab.windowId !== owner!.scanWindowId ||
      !window.focused
    )
      throw new Error(
        'Activeer het voorbereide scantabblad en start via de toolbar.',
      );
    return owner!;
  }
  return { prepareAdvancedScan, validateAdvancedStart };
}

function assertPreparationSource(
  source: chrome.tabs.Tab,
): asserts source is chrome.tabs.Tab & { id: number; url: string } {
  if (
    source.id === undefined ||
    !source.url ||
    !/^https?:/.test(source.url) ||
    source.pinned ||
    source.groupId !== -1
  )
    throw new Error('Open een gewone, niet-vastgemaakte website-tab.');
}

function assertPreparationWindow(
  window: chrome.windows.Window,
  foreground: chrome.tabs.Tab | undefined,
  sourceId: number,
  allowInactiveSource: boolean,
): asserts window is chrome.windows.Window & {
  width: number;
  height: number;
  left: number;
  top: number;
} {
  if (
    !window.focused ||
    !foreground?.id ||
    (!allowInactiveSource && foreground.id !== sourceId) ||
    window.width === undefined ||
    window.height === undefined ||
    window.left === undefined ||
    window.top === undefined
  )
    throw new Error('Activeer eerst het oorspronkelijke websitevenster.');
}
