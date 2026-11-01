import type { BackgroundCommand } from './command-protocol';
import { historySummary } from './history';
import { TERMINAL_STATES } from './model';
import type { CommandServices } from './runner-command-services';
import {
  applyRetention,
  getHistorySettings,
  getPendingRecheck,
  getScanPreferences,
  listJobs,
  mutateJob,
} from './store';
/** Handle state commands after runtime parsing; ownership checks precede mutations. */
export async function runnerCommandState(
  services: CommandServices,
  message: Extract<
    BackgroundCommand,
    {
      type:
        'GET_STATE' | 'CANDIDATE_EVENT' | 'CAPTURE_HEARTBEAT' | 'CAPTURE_LOST';
    }
  >,
) {
  switch (message.type) {
    case 'CANDIDATE_EVENT':
      return oncandidateEvent(services, message);
    case 'GET_STATE':
      return ongetState(services, message);
    case 'CAPTURE_HEARTBEAT':
      return oncaptureHeartbeat(services, message);
    case 'CAPTURE_LOST':
      return oncaptureLost(services, message);
  }
}

async function oncandidateEvent(
  services: CommandServices,
  message: Extract<BackgroundCommand, { type: 'CANDIDATE_EVENT' }>,
) {
  const segment = services.capture.activeSegment;
  if (
    !segment ||
    message.generation !== segment.generation ||
    message.segmentId !== segment.segmentId ||
    segment.events.length >= 8
  )
    return {};
  const request = services
    .content(
      segment.jobId,
      segment.generation,
      'FG_SOURCE_TIMELINE_EVENT',
      {
        generation: segment.generation,
        segmentId: segment.segmentId,
        event: message,
      },
      1_500,
    )
    .catch(() => undefined);
  segment.events.push(request);
  await request;
  return {};
}

async function ongetState(
  services: CommandServices,
  message: Extract<BackgroundCommand, { type: 'GET_STATE' }>,
) {
  await services.reconcileMissingAdvancedTab();
  if (Date.now() - services.execution.retentionCheckedAt > 3600_000) {
    await applyRetention();
    services.execution.retentionCheckedAt = Date.now();
  }
  const tab =
    typeof message.inspectedTabId === 'number'
      ? await chrome.tabs.get(message.inspectedTabId)
      : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  const jobs = await listJobs();
  const workspaceRecovery = [];
  for (const job of jobs) {
    if (!TERMINAL_STATES.includes(job.state) && job.state !== 'PAUSED')
      continue;
    const intent = await services.unresolvedWorkspaceIntent(job.id);
    if (intent) workspaceRecovery.push({ jobId: job.id, ...intent });
  }
  const advancedOwner = await services.loadAdvancedOwner();
  return {
    ...(advancedOwner?.phase === 'PREPARED' &&
    advancedOwner.scanTabId !== undefined
      ? {
          advancedPreparation: {
            tabId: advancedOwner.scanTabId,
            originalTabId: advancedOwner.source.tabId,
            mode: advancedOwner.mode,
            viewportSeconds: advancedOwner.viewportSeconds,
          },
        }
      : {}),
    ...(advancedOwner &&
    ['MANUAL', 'CREATE_INTENT', 'CLOSING'].includes(advancedOwner.phase)
      ? {
          advancedRecovery: {
            tabId: advancedOwner.scanTabId,
            reason:
              advancedOwner.reason ??
              'De eigenaar of sluiting is niet bevestigd; er wordt geen tabblad geraden of verwijderd.',
          },
        }
      : {}),
    jobs,
    workspaceRecovery,
    tab: { id: tab?.id, url: tab?.url },
    webOrigin: services.__WEB_ORIGIN__,
    settings: await getHistorySettings(),
    sites: historySummary(jobs),
    preferences: await getScanPreferences(),
    recheck: await getPendingRecheck(),
    advancedPointerAvailable:
      chrome.runtime.getManifest().permissions?.includes('debugger') === true,
  };
}

async function oncaptureHeartbeat(
  _services: CommandServices,
  _message: Extract<BackgroundCommand, { type: 'CAPTURE_HEARTBEAT' }>,
) {
  return {};
}

async function oncaptureLost(
  services: CommandServices,
  message: Extract<BackgroundCommand, { type: 'CAPTURE_LOST' }>,
) {
  for (const job of await listJobs())
    if (
      job.generation === message.generation &&
      ['AUTHORIZING', 'RUNNING'].includes(job.state) &&
      services.capture.captureSources.get(job.id)?.sourceId === message.sourceId
    ) {
      await mutateJob(job.id, (state) => {
        state.state = 'INTERRUPTED';
        state.stopIntent = true;
        state.stopReason = message.reason ?? 'CAPTURE_LOST';
        state.endedAt = services.now();
      });
    }
  return {};
}
