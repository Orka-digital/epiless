import type { BackgroundCommand } from './command-protocol';
import { matchingRecord } from './disposable-scan';
import { viewportDuration } from './model';
import type { CommandServices } from './runner-command-services';
import {
  consumeStartIntent,
  getJob,
  getPendingRecheck,
  getStartIntent,
  putStartIntent,
  setPendingRecheck,
} from './store';
import { buildVerificationPlan } from './verification';
/** Handle preparation commands after runtime parsing; ownership checks precede mutations. */
export async function runnerCommandPreparation(
  services: CommandServices,
  message: Extract<
    BackgroundCommand,
    {
      type:
        | 'PREPARE_ADVANCED_SCAN'
        | 'CANCEL_ADVANCED_SCAN'
        | 'PREPARE_RECHECK'
        | 'PREPARE_START'
        | 'CONTINUE_START'
        | 'CANCEL_START';
    }
  >,
  continueStartIntent: () => Promise<void>,
) {
  switch (message.type) {
    case 'PREPARE_ADVANCED_SCAN':
      return onprepareAdvancedScan(services, message);
    case 'CANCEL_ADVANCED_SCAN':
      return oncancelAdvancedScan(services, message);
    case 'PREPARE_RECHECK':
      return onprepareRecheck(services, message);
    case 'PREPARE_START':
      return onprepareStart(services, message, continueStartIntent);
    case 'CONTINUE_START':
      return oncontinueStart(services, message, continueStartIntent);
    case 'CANCEL_START':
      return oncancelStart(services, message);
  }
}

async function onprepareAdvancedScan(
  services: CommandServices,
  message: Extract<BackgroundCommand, { type: 'PREPARE_ADVANCED_SCAN' }>,
) {
  await services.reconcileMissingAdvancedTab();
  return services.prepareAdvancedScan(message);
}

async function oncancelAdvancedScan(
  services: CommandServices,
  message: Extract<BackgroundCommand, { type: 'CANCEL_ADVANCED_SCAN' }>,
) {
  const owner = await services.loadAdvancedOwner();
  if (
    !owner ||
    owner.scanTabId !== message.tabId ||
    owner.phase !== 'PREPARED' ||
    owner.jobId
  )
    throw new Error('Deze voorbereiding kan niet automatisch worden gesloten.');
  if (!(await services.closeAdvancedOwner(owner)))
    throw new Error(
      'Het scantabblad bleef behouden: controleer de handmatige herstelmelding.',
    );
  const pending = await getPendingRecheck();
  if (
    pending &&
    pending.tabId === owner.scanTabId &&
    matchingRecord(pending.replayOf, owner.replayOf)
  )
    await setPendingRecheck(undefined);
  return {};
}

async function onprepareRecheck(
  services: CommandServices,
  message: Extract<BackgroundCommand, { type: 'PREPARE_RECHECK' }>,
) {
  if (services.execution.running || services.execution.authorizing)
    throw new Error(
      'Stop de huidige scan voordat je een hercontrole voorbereidt.',
    );
  const ref = message.replayOf;
  const previous = ref && (await getJob(ref.jobId));
  if (!previous) throw new Error('De oorspronkelijke scan ontbreekt.');
  const plan = buildVerificationPlan(previous, ref.taskId, ref.observationId);
  if (previous.advancedPointer) {
    if (!previous.disposableSource)
      throw new Error(
        'Deze oudere geavanceerde scan vereist een nieuwe afzonderlijke voorbereiding.',
      );
    const original = await chrome.tabs
      .get(previous.disposableSource.originalTabId)
      .catch(() => undefined);
    if (
      !original ||
      original.id === undefined ||
      original.url !== previous.disposableSource.originalUrl
    )
      throw new Error(
        'Open eerst de oorspronkelijke website opnieuw en bereid een nieuwe geavanceerde scan voor.',
      );
    const prepared = await services.prepareAdvancedScan(
      {
        tabId: original.id,
        mode: 'AUTONOMOUS',
        viewportSeconds: 15,
        replayOf: {
          jobId: previous.id,
          taskId: ref.taskId,
          observationId: ref.observationId,
        },
      },
      plan.route,
      true,
    );
    await setPendingRecheck({
      replayOf: {
        jobId: previous.id,
        taskId: ref.taskId,
        observationId: ref.observationId,
      },
      route: plan.route,
      tabId: prepared.tabId,
    });
    return prepared;
  }
  const tab = await chrome.tabs.create({ url: plan.route, active: true });
  if (tab.id === undefined)
    throw new Error('Hercontroletab kon niet geopend worden.');
  await setPendingRecheck({
    replayOf: {
      jobId: previous.id,
      taskId: ref.taskId,
      observationId: ref.observationId,
    },
    route: plan.route,
    tabId: tab.id,
  });
  return { tabId: tab.id };
}

async function onprepareStart(
  _services: CommandServices,
  message: Extract<BackgroundCommand, { type: 'PREPARE_START' }>,
  continueStartIntent: () => Promise<void>,
) {
  const tab = await chrome.tabs.get(message.tabId);
  if (!tab.url) throw new Error('Geen website geselecteerd.');
  const origin = new URL(tab.url).origin;
  await putStartIntent({
    id: crypto.randomUUID(),
    tabId: message.tabId,
    origin,
    mode:
      message.mode === 'EXTENDED'
        ? 'EXTENDED'
        : message.mode === 'QUICK'
          ? 'QUICK'
          : 'AUTONOMOUS',
    viewportSeconds:
      viewportDuration(message.mode ?? 'AUTONOMOUS', message.viewportSeconds) /
      1000,
    expiresAt: Date.now() + 120_000,
    ...(message.replayOf ? { replayOf: message.replayOf } : {}),
    advancedPointer: message.advancedPointer === true,
  });
  await continueStartIntent();
  return {};
}

async function oncontinueStart(
  _services: CommandServices,
  _message: Extract<BackgroundCommand, { type: 'CONTINUE_START' }>,
  continueStartIntent: () => Promise<void>,
) {
  await continueStartIntent();
  return {};
}

async function oncancelStart(
  _services: CommandServices,
  message: Extract<BackgroundCommand, { type: 'CANCEL_START' }>,
) {
  const intent = await getStartIntent();
  if (intent && intent.tabId === message.tabId)
    await consumeStartIntent(intent.id);
  return {};
}
