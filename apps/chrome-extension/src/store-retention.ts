import { expireJobDetails } from './history';
import {
  DEFAULT_HISTORY_SETTINGS,
  type HistorySettings,
  type ScanJob,
} from './model';
import { readHistorySettings } from './store-control-schema';
import { completed, open, request } from './store-db';

/** Preserve configured retention; corrupt records must not trigger automatic deletion. */
export async function getHistorySettings(): Promise<HistorySettings> {
  const value = await request<HistorySettings | undefined>(
    (await open())
      .transaction('control', 'readonly')
      .objectStore('control')
      .get('history-settings'),
  );
  return value === undefined
    ? { ...DEFAULT_HISTORY_SETTINGS }
    : readHistorySettings(value);
}

/** Commit a supported retention choice, then apply it to stored job details. */
export async function setHistorySettings(input: unknown): Promise<void> {
  const days =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>).detailRetentionDays
      : undefined;
  if (days !== null && days !== 30 && days !== 90 && days !== 365)
    throw new Error('Kies 30, 90, 365 dagen of bewaren tot je zelf wist.');
  const tx = (await open()).transaction('control', 'readwrite');
  const done = completed(tx);
  tx.objectStore('control').put(
    { schemaVersion: 1, detailRetentionDays: days },
    'history-settings',
  );
  await done;
  await applyRetention();
}

/** Expire eligible details in one transaction while preserving compact history. */
export async function applyRetention(at = Date.now()): Promise<void> {
  const settings = await getHistorySettings();
  const tx = (await open()).transaction('jobs', 'readwrite');
  const done = completed(tx);
  const jobs = await request<ScanJob[]>(tx.objectStore('jobs').getAll());
  for (const job of jobs)
    if (expireJobDetails(job, settings, at)) tx.objectStore('jobs').put(job);
  await done;
}
