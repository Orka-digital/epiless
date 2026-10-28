import { parseBackgroundCommand } from './command-protocol';
import { runnerCommandHistory } from './runner-command-history';
import { runnerCommandLifecycle } from './runner-command-lifecycle';
import { runnerCommandPreparation } from './runner-command-preparation';
import type { CommandServices } from './runner-command-services';
import { runnerCommandStart } from './runner-command-start';
import { runnerCommandState } from './runner-command-state';
import { consumeStartIntent, getStartIntent } from './store';
import { handleVerificationCommand } from './verification-control';
/** Parse untrusted commands once, then route them to focused worker capabilities. */
export function createRunnerCommands(services: CommandServices) {
  async function handle(input: unknown) {
    const message = parseBackgroundCommand(input);
    await services.initialized;
    if (
      message.type === 'PREPARE_ADVANCED_SCAN' ||
      message.type === 'CANCEL_ADVANCED_SCAN'
    )
      return runnerCommandPreparation(services, message, continueStartIntent);
    const verification = await handleVerificationCommand(message);
    if (verification.handled) return verification.value;
    switch (message.type) {
      case 'PREPARE_RECHECK':
      case 'PREPARE_START':
      case 'CONTINUE_START':
      case 'CANCEL_START':
        return runnerCommandPreparation(services, message, continueStartIntent);
      case 'GET_STATE':
      case 'CANDIDATE_EVENT':
      case 'CAPTURE_HEARTBEAT':
      case 'CAPTURE_LOST':
        return runnerCommandState(services, message);
      case 'RESUME':
      case 'PAUSE':
      case 'STOP':
      case 'OPEN_TARGET':
        return runnerCommandLifecycle(services, message);
      case 'EXPORT':
      case 'EXPORT_HTML':
      case 'EXPORT_HISTORY':
      case 'SET_HISTORY_SETTINGS':
      case 'SET_SCAN_PREFERENCES':
      case 'DELETE_HISTORY':
      case 'DELETE':
      case 'OPEN_DASHBOARD':
      case 'PUBLISH_PREVIEW':
        return runnerCommandHistory(services, message);
      case 'START':
        return runnerCommandStart(services, message);
      default:
        throw new Error('Onbekende opdracht.');
    }
  }
  async function continueStartIntent() {
    const pending = await getStartIntent();
    if (
      !pending ||
      pending.expiresAt <= Date.now() ||
      !(await chrome.permissions.contains({ origins: [`${pending.origin}/*`] }))
    )
      return;
    const tab = await chrome.tabs.get(pending.tabId).catch(() => undefined);
    if (!tab?.url || new URL(tab.url).origin !== pending.origin) {
      await consumeStartIntent(pending.id);
      return;
    }
    const intent = await consumeStartIntent(pending.id);
    if (intent)
      await handle({
        type: 'START',
        tabId: intent.tabId,
        mode: intent.mode,
        viewportSeconds: intent.viewportSeconds,
        replayOf: intent.replayOf,
        advancedPointer: intent.advancedPointer,
      });
  }
  return { handle, continueStartIntent };
}
