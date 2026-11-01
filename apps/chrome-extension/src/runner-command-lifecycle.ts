import { ENGINE_VERSION } from '@epi-less/analysis-engine';
import { stopRequestedCapture } from './capture-stop';
import type { BackgroundCommand } from './command-protocol';
import { canResumeWithVersions } from './model';
import type { CommandServices } from './runner-command-services';
import { getJob, mutateJob, resumeLease } from './store';
/** Handle lifecycle commands after runtime parsing; ownership checks precede mutations. */
export async function runnerCommandLifecycle(
  services: CommandServices,
  message: Extract<
    BackgroundCommand,
    { type: 'RESUME' | 'PAUSE' | 'STOP' | 'OPEN_TARGET' }
  >,
) {
  switch (message.type) {
    case 'RESUME':
      return onresume(services, message);
    case 'PAUSE':
    case 'STOP':
      return onpause(services, message);
    case 'OPEN_TARGET':
      return onopenTarget(services, message);
  }
}

async function onresume(
  services: CommandServices,
  message: Extract<BackgroundCommand, { type: 'RESUME' }>,
) {
  if (services.execution.running || services.execution.authorizing)
    throw new Error('Wacht tot de vorige meetstap is afgesloten.');
  const previous = await getJob(message.id);
  if (previous && !canResumeWithVersions(previous, ENGINE_VERSION))
    throw new Error(
      'De exacte scannerbuild ontbreekt of verschilt sinds deze scan. Start een nieuwe scan zodat meetversies niet worden gemengd. Het bestaande rapport blijft bewaard.',
    );
  const resumeOwner = previous?.disposableSource
    ? await services.validateAdvancedStart(
        {
          tabId: previous.tabId,
          mode: previous.mode,
          viewportSeconds: (previous.viewportDurationMs ?? 15000) / 1000,
          replayOf: previous.verificationOf,
        },
        true,
      )
    : undefined;
  if (previous?.advancedPointer && !resumeOwner)
    throw new Error(
      'Start voor deze oudere geavanceerde scan een nieuwe afzonderlijke voorbereiding.',
    );
  if (
    resumeOwner &&
    (resumeOwner.jobId !== previous!.id ||
      resumeOwner.generation !== previous!.generation)
  )
    throw new Error('ADVANCED_JOB_OWNER_CHANGED');
  const job = await resumeLease(message.id, crypto.randomUUID());
  if (resumeOwner)
    await services.persistAdvancedOwner({
      ...resumeOwner,
      phase: 'RUNNING',
      generation: job.generation,
    });
  await services.authorize(job);
  if (resumeOwner) await services.showAdvancedDashboard(job);
  return { id: job.id };
}

async function onpause(
  services: CommandServices,
  message: Extract<BackgroundCommand, { type: 'PAUSE' | 'STOP' }>,
) {
  await stopRequestedCapture({
    id: message.id,
    type: message.type,
    running: Boolean(services.execution.running),
    now: services.now,
    mutate: mutateJob,
    cancel: (tabId) => chrome.tabs.sendMessage(tabId, { type: 'FG_CANCEL' }),
    stop: (generation) => services.offscreen('CAPTURE_STOP', { generation }),
  });
  if (
    message.type === 'STOP' &&
    !services.execution.running &&
    !services.execution.authorizing
  ) {
    const stopped = await getJob(message.id);
    if (stopped?.disposableSource)
      await services.finalizeAdvancedJob(stopped.id, stopped.generation);
  }
  return {};
}

async function onopenTarget(
  _services: CommandServices,
  message: Extract<BackgroundCommand, { type: 'OPEN_TARGET' }>,
) {
  const job = await getJob(message.id);
  if (job?.disposableSource?.closed)
    throw new Error(
      'Het tijdelijke scantabblad is gesloten; het rapport blijft beschikbaar.',
    );
  if (job) await chrome.tabs.update(job.tabId, { active: true });
  return {};
}
