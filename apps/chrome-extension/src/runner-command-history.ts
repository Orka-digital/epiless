import { contentHash } from '@epi-less/core';
import type { BackgroundCommand } from './command-protocol';
import {
  buildHistoryExport,
  buildHtmlReport,
  prepareExportJobs,
} from './export';
import { TERMINAL_STATES } from './model';
import { buildReport } from './report';
import type { CommandServices } from './runner-command-services';
import {
  deleteHistory,
  deleteJob,
  getHistorySettings,
  getJob,
  listJobs,
  putTransfer,
  setHistorySettings,
  setScanPreferences,
} from './store';
/** Handle history commands after runtime parsing; ownership checks precede mutations. */
export async function runnerCommandHistory(
  services: CommandServices,
  message: Extract<
    BackgroundCommand,
    {
      type:
        | 'EXPORT'
        | 'EXPORT_HTML'
        | 'EXPORT_HISTORY'
        | 'SET_HISTORY_SETTINGS'
        | 'SET_SCAN_PREFERENCES'
        | 'DELETE_HISTORY'
        | 'DELETE'
        | 'OPEN_DASHBOARD'
        | 'PUBLISH_PREVIEW';
    }
  >,
) {
  switch (message.type) {
    case 'EXPORT':
      return onexport(services, message);
    case 'EXPORT_HTML':
      return onexportHtml(services, message);
    case 'EXPORT_HISTORY':
      return onexportHistory(services, message);
    case 'SET_HISTORY_SETTINGS':
      return onsetHistorySettings(services, message);
    case 'SET_SCAN_PREFERENCES':
      return onsetScanPreferences(services, message);
    case 'DELETE_HISTORY':
      return ondeleteHistory(services, message);
    case 'DELETE':
      return ondelete(services, message);
    case 'OPEN_DASHBOARD':
      return onopenDashboard(services, message);
    case 'PUBLISH_PREVIEW':
      return onpublishPreview(services, message);
  }
}

async function onexport(
  _services: CommandServices,
  message: Extract<BackgroundCommand, { type: 'EXPORT' }>,
) {
  const job = await getJob(message.id);
  if (!job) throw new Error('Rapport niet gevonden.');
  return buildReport(
    prepareExportJobs([job], message.pseudonymize === true)[0],
  );
}

async function onexportHtml(
  _services: CommandServices,
  message: Extract<BackgroundCommand, { type: 'EXPORT_HTML' }>,
) {
  const job = await getJob(message.id);
  if (!job) throw new Error('Rapport niet gevonden.');
  return buildHtmlReport(job, message.pseudonymize === true);
}

async function onexportHistory(
  _services: CommandServices,
  message: Extract<BackgroundCommand, { type: 'EXPORT_HISTORY' }>,
) {
  const jobs = (await listJobs()).filter(
    (job) => !message.origin || job.origin === message.origin,
  );
  return buildHistoryExport(
    jobs,
    await getHistorySettings(),
    message.origin ? 'SITE' : 'ALL',
    message.pseudonymize === true,
  );
}

async function onsetHistorySettings(
  _services: CommandServices,
  message: Extract<BackgroundCommand, { type: 'SET_HISTORY_SETTINGS' }>,
) {
  await setHistorySettings(message.settings);
  return {};
}

async function onsetScanPreferences(
  _services: CommandServices,
  message: Extract<BackgroundCommand, { type: 'SET_SCAN_PREFERENCES' }>,
) {
  await setScanPreferences(message.mode, message.viewportSeconds);
  return {};
}

async function ondeleteHistory(
  services: CommandServices,
  message: Extract<BackgroundCommand, { type: 'DELETE_HISTORY' }>,
) {
  const owner = await services.loadAdvancedOwner();
  if (owner?.jobId)
    throw new Error(
      'Sluit eerst de geavanceerde scan of handel de handmatige herstelmelding af.',
    );
  await deleteHistory(
    typeof message.origin === 'string' ? message.origin : undefined,
  );
  return {};
}

async function ondelete(
  services: CommandServices,
  message: Extract<BackgroundCommand, { type: 'DELETE' }>,
) {
  if ((await services.loadAdvancedOwner())?.jobId === message.id)
    throw new Error('Sluit eerst het bijbehorende scantabblad.');
  await deleteJob(message.id);
  return {};
}

async function onopenDashboard(
  _services: CommandServices,
  _message: Extract<BackgroundCommand, { type: 'OPEN_DASHBOARD' }>,
) {
  await chrome.tabs.create({
    url: chrome.runtime.getURL('dashboard.html'),
  });
  return {};
}

async function onpublishPreview(
  services: CommandServices,
  message: Extract<BackgroundCommand, { type: 'PUBLISH_PREVIEW' }>,
) {
  const job = await getJob(message.id);
  if (!job || !TERMINAL_STATES.includes(job.state))
    throw new Error(
      'Rond de scan eerst af voordat je een uploadvoorbeeld opent.',
    );
  const snapshot = JSON.parse(JSON.stringify(buildReport(job)));
  const hash = await contentHash(snapshot);
  const nonce = crypto.randomUUID() + crypto.randomUUID();
  const tab = await chrome.tabs.create({
    url: 'about:blank',
    active: true,
  });
  if (tab.id === undefined)
    throw new Error('Uploadvoorbeeld kon niet geopend worden.');
  await putTransfer({
    nonce,
    jobId: job.id,
    expectedTabId: tab.id,
    expiresAt: Date.now() + 5 * 60_000,
    snapshot,
    contentHash: hash,
  });
  await chrome.tabs.update(tab.id, {
    url: `${services.__WEB_ORIGIN__}/publish#extension=${chrome.runtime.id}&nonce=${nonce}`,
  });
  return {};
}
