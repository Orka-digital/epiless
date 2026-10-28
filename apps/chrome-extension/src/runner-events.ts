import { contentHash } from '@epi-less/core';
import { TERMINAL_STATES } from './model';
import { trustedTransferSender } from './runner-policy';
import { CaptureOwner, WorkspaceOwner } from './runner-runtime';
import type { StoredPointerSession } from './runner-types';
import { consumeTransfer, listJobs, mutateJob } from './store';

import type { RunnerOperations } from './runner-contracts';
type EventServices = Pick<
  RunnerOperations,
  | 'errorText'
  | 'now'
  | 'offscreen'
  | 'reconcileMissingAdvancedTab'
  | 'pointerKey'
> & {
  initialized: Promise<void>;
  continueStartIntent: () => Promise<unknown>;
  handle: (message: unknown) => Promise<unknown>;
  workspace: WorkspaceOwner;
  capture: CaptureOwner;
  closingAdvancedTabs: Set<number>;
  __WEB_ORIGIN__: string;
};
/** Register worker listeners against explicit owners; external transfers remain origin- and tab-bound. */
export function registerRunnerEvents(services: EventServices) {
  const {
    errorText,
    now,
    offscreen,
    reconcileMissingAdvancedTab,
    pointerKey,
    initialized,
    continueStartIntent,
    handle,
    workspace,
    capture,
    closingAdvancedTabs,
    __WEB_ORIGIN__,
  } = services;
  chrome.permissions.onAdded.addListener(() => {
    void initialized.then(continueStartIntent).catch(() => undefined);
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (
      sender.id !== chrome.runtime.id ||
      message?.target === 'offscreen' ||
      (sender.tab && !sender.url?.startsWith(chrome.runtime.getURL('')))
    )
      return;
    void handle(message).then(
      (value) => respond({ ok: true, value }),
      (error) => respond({ ok: false, error: errorText(error) }),
    );
    return true;
  });
  chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
    if (
      message?.type !== 'FLASHGUARD_IMPORT' ||
      typeof message.nonce !== 'string' ||
      message.nonce.length > 100 ||
      !trustedTransferSender(sender, __WEB_ORIGIN__)
    ) {
      respond({ ok: false, error: 'Invalid transfer request' });
      return;
    }
    void (async () => {
      await initialized;
      const transfer = await consumeTransfer(message.nonce, sender.tab.id);
      if (!transfer)
        throw new Error('Transfer expired, consumed or opened in another tab');
      if (
        !transfer.snapshot ||
        (await contentHash(transfer.snapshot)) !== transfer.contentHash
      )
        throw new Error(
          'Transfer snapshot is unavailable or changed; reopen the upload preview.',
        );
      return transfer.snapshot;
    })().then(
      (report) => respond({ ok: true, report }),
      (error) => respond({ ok: false, error: errorText(error) }),
    );
    return true;
  });
  chrome.tabs.onZoomChange.addListener(({ tabId }) => {
    capture.pageZoomRevisions.set(
      tabId,
      (capture.pageZoomRevisions.get(tabId) ?? 0) + 1,
    );
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (closingAdvancedTabs.has(tabId)) return;
    capture.pageZoomRevisions.delete(tabId);
    void initialized.then(async () => {
      await reconcileMissingAdvancedTab();
      for (const job of await listJobs())
        if (job.tabId === tabId && !TERMINAL_STATES.includes(job.state)) {
          await mutateJob(job.id, (state) => {
            state.state = 'INTERRUPTED';
            state.stopIntent = true;
            state.stopReason = 'SCAN_TAB_CLOSED';
            state.endedAt = now();
          });
          await offscreen('CAPTURE_STOP', { generation: job.generation }).catch(
            () => undefined,
          );
        }
    });
  });
  chrome.debugger?.onDetach.addListener((source, reason) => {
    const entry = [...workspace.pointerSessions].find(
      ([, session]) => session.tabId === source.tabId,
    );
    if (!entry) return;
    const [id, session] = entry;
    if (workspace.intentionalPointerDetaches.has(session)) return;
    workspace.pointerSessions.delete(id);
    void (async () => {
      const stored = (
        await chrome.storage.session.get(pointerKey(session.tabId))
      )[pointerKey(session.tabId)] as StoredPointerSession | undefined;
      if (stored?.jobId === id && stored.generation === session.generation)
        await chrome.storage.session.remove(pointerKey(session.tabId));
      await mutateJob(id, (job) => {
        if (
          job.generation !== session.generation ||
          TERMINAL_STATES.includes(job.state)
        )
          return;
        job.state = 'INTERRUPTED';
        job.stopIntent = true;
        job.endedAt = now();
        job.stopReason = `DEBUGGER_SESSION_LOST: ${reason}`;
        job.limitations.push('TRUSTED_POINTER_SESSION_INTERRUPTED');
      });
      await chrome.tabs
        .sendMessage(session.tabId, { type: 'FG_CANCEL' })
        .catch(() => undefined);
      await offscreen('CAPTURE_STOP', { generation: session.generation }).catch(
        () => undefined,
      );
    })();
  });
}
