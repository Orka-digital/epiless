import {
  DEFAULT_HISTORY_SETTINGS,
  TERMINAL_STATES,
  type ScanJob,
  type Transfer,
  type ScanMode,
  type HistorySettings,
  viewportDuration,
} from './model';
import { expireJobDetails } from './history';

const DATABASE = 'flashguard-audit-v1';
export interface StartIntent {
  id: string;
  tabId: number;
  origin: string;
  mode: ScanMode;
  viewportSeconds?: number;
  replayOf?: { jobId: string; taskId: string; observationId: string };
  advancedPointer?: boolean;
  expiresAt: number;
}
export interface PendingRecheck {
  replayOf: { jobId: string; taskId: string; observationId: string };
  route: string;
  tabId: number;
}
export async function getPendingRecheck(): Promise<PendingRecheck | undefined> {
  return request(
    (await open())
      .transaction('control', 'readonly')
      .objectStore('control')
      .get('pending-recheck'),
  );
}
export async function setPendingRecheck(
  value: PendingRecheck | undefined,
): Promise<void> {
  const tx = (await open()).transaction('control', 'readwrite');
  const done = completed(tx);
  if (value) tx.objectStore('control').put(value, 'pending-recheck');
  else tx.objectStore('control').delete('pending-recheck');
  await done;
}
export async function getScanPreferences(): Promise<{
  mode: ScanMode;
  viewportSeconds: number;
}> {
  return (
    (await request(
      (await open())
        .transaction('control', 'readonly')
        .objectStore('control')
        .get('scan-preferences'),
    )) ?? { mode: 'AUTONOMOUS', viewportSeconds: 30 }
  );
}
export async function setScanPreferences(
  mode: unknown,
  seconds: unknown,
): Promise<void> {
  if (mode !== 'AUTONOMOUS' && mode !== 'QUICK' && mode !== 'EXTENDED')
    throw new Error('Ongeldige scanmodus.');
  const tx = (await open()).transaction('control', 'readwrite');
  const done = completed(tx);
  tx.objectStore('control').put(
    { mode, viewportSeconds: viewportDuration('EXTENDED', seconds) / 1000 },
    'scan-preferences',
  );
  await done;
}
let database: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      // Additive migration: preserve every v1 job and pending control record.
      if (!request.result.objectStoreNames.contains('jobs'))
        request.result.createObjectStore('jobs', { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains('control'))
        request.result.createObjectStore('control');
      if (!request.result.objectStoreNames.contains('transfers'))
        request.result.createObjectStore('transfers', { keyPath: 'nonce' });
      request.transaction!.objectStore('control').put(2, 'storage-schema');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}
export async function getHistorySettings(): Promise<HistorySettings> {
  const value = await request<HistorySettings | undefined>(
    (await open())
      .transaction('control', 'readonly')
      .objectStore('control')
      .get('history-settings'),
  );
  return value ?? { ...DEFAULT_HISTORY_SETTINGS };
}
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
export async function applyRetention(at = Date.now()): Promise<void> {
  const settings = await getHistorySettings();
  const tx = (await open()).transaction('jobs', 'readwrite');
  const done = completed(tx);
  const jobs = await request<ScanJob[]>(tx.objectStore('jobs').getAll());
  for (const job of jobs)
    if (expireJobDetails(job, settings, at)) tx.objectStore('jobs').put(job);
  await done;
}
export async function deleteHistory(origin?: string): Promise<void> {
  const tx = (await open()).transaction(
    ['jobs', 'control', 'transfers'],
    'readwrite',
  );
  const done = completed(tx);
  const jobs = await request<ScanJob[]>(tx.objectStore('jobs').getAll());
  const active = await request<string | undefined>(
    tx.objectStore('control').get('active'),
  );
  const selected = new Set(
    jobs.filter((job) => !origin || job.origin === origin).map((job) => job.id),
  );
  if (active && selected.has(active)) {
    tx.abort();
    await done.catch(() => undefined);
    throw new Error('Stop de scan voordat je deze geschiedenis verwijdert.');
  }
  for (const id of selected) tx.objectStore('jobs').delete(id);
  const transfers = await request<Transfer[]>(
    tx.objectStore('transfers').getAll(),
  );
  for (const transfer of transfers)
    if (!origin || selected.has(transfer.jobId))
      tx.objectStore('transfers').delete(transfer.nonce);
  const intent = await request<StartIntent | undefined>(
    tx.objectStore('control').get('start-intent'),
  );
  if (intent && (!origin || intent.origin === origin))
    tx.objectStore('control').delete('start-intent');
  const recheck = await request<PendingRecheck | undefined>(
    tx.objectStore('control').get('pending-recheck'),
  );
  if (recheck && selected.has(recheck.replayOf.jobId))
    tx.objectStore('control').delete('pending-recheck');
  if (!origin) {
    tx.objectStore('control').clear();
    tx.objectStore('control').put(2, 'storage-schema');
  }
  await done;
}
function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}
function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(
        transaction.error ??
          new Error('Local storage transaction was cancelled.'),
      );
  });
}
export async function listJobs(): Promise<ScanJob[]> {
  const tx = (await open()).transaction('jobs', 'readonly');
  return (await request<ScanJob[]>(tx.objectStore('jobs').getAll())).sort(
    (a, b) => b.startedAt.localeCompare(a.startedAt),
  );
}
export async function getJob(id: string): Promise<ScanJob | undefined> {
  return request(
    (await open()).transaction('jobs', 'readonly').objectStore('jobs').get(id),
  );
}
export async function mutateJob(
  id: string,
  mutate: (job: ScanJob) => void,
): Promise<ScanJob | undefined> {
  const tx = (await open()).transaction(['jobs', 'control'], 'readwrite');
  const done = completed(tx);
  const job = await request<ScanJob | undefined>(
    tx.objectStore('jobs').get(id),
  );
  if (job) {
    try {
      mutate(job);
    } catch (error) {
      tx.abort();
      await done.catch(() => undefined);
      throw error;
    }
    job.updatedAt = new Date().toISOString();
    tx.objectStore('jobs').put(job);
    if (TERMINAL_STATES.includes(job.state)) {
      const active = await request<string | undefined>(
        tx.objectStore('control').get('active'),
      );
      if (active === id) tx.objectStore('control').delete('active');
    }
  }
  await done;
  return job;
}
export async function createJob(job: ScanJob): Promise<void> {
  const tx = (await open()).transaction(['jobs', 'control'], 'readwrite');
  const done = completed(tx);
  const active = await request<string | undefined>(
    tx.objectStore('control').get('active'),
  );
  if (active) {
    tx.abort();
    await done.catch(() => undefined);
    throw new Error('Er loopt al een scan. Pauzeer of stop die eerst.');
  }
  tx.objectStore('jobs').put(job);
  tx.objectStore('control').put(job.id, 'active');
  await done;
}
export async function resumeLease(
  id: string,
  generation: string,
): Promise<ScanJob> {
  const tx = (await open()).transaction(['jobs', 'control'], 'readwrite');
  const done = completed(tx);
  const active = await request<string | undefined>(
    tx.objectStore('control').get('active'),
  );
  const job = await request<ScanJob | undefined>(
    tx.objectStore('jobs').get(id),
  );
  if (
    !job ||
    !['PAUSED', 'INTERRUPTED'].includes(job.state) ||
    (active && active !== id)
  ) {
    tx.abort();
    await done.catch(() => undefined);
    throw new Error('Deze scan kan nu niet hervat worden.');
  }
  job.state = 'AUTHORIZING';
  job.stopIntent = false;
  job.generation = generation;
  delete job.endedAt;
  delete job.stopReason;
  for (const task of job.tasks) {
    if (task.state === 'RUNNING' || task.id === job.interruptedTaskId) {
      task.state = 'QUEUED';
      task.reasons.push(
        'Herstart vanaf een bekende paginatoestand; eerdere observaties blijven bewaard.',
      );
    }
    delete task.pendingAction;
  }
  delete job.interruptedTaskId;
  tx.objectStore('jobs').put(job);
  tx.objectStore('control').put(id, 'active');
  await done;
  return job;
}
export async function deleteJob(id: string): Promise<void> {
  const tx = (await open()).transaction(
    ['jobs', 'control', 'transfers'],
    'readwrite',
  );
  const done = completed(tx);
  const active = await request<string | undefined>(
    tx.objectStore('control').get('active'),
  );
  if (active === id) {
    tx.abort();
    await done.catch(() => undefined);
    throw new Error('Stop de scan voordat je deze verwijdert.');
  }
  tx.objectStore('jobs').delete(id);
  const transfers = await request<Transfer[]>(
    tx.objectStore('transfers').getAll(),
  );
  for (const transfer of transfers)
    if (transfer.jobId === id)
      tx.objectStore('transfers').delete(transfer.nonce);
  const recheck = await request<PendingRecheck | undefined>(
    tx.objectStore('control').get('pending-recheck'),
  );
  if (recheck?.replayOf.jobId === id)
    tx.objectStore('control').delete('pending-recheck');
  const intent = await request<StartIntent | undefined>(
    tx.objectStore('control').get('start-intent'),
  );
  if (intent?.replayOf?.jobId === id)
    tx.objectStore('control').delete('start-intent');
  await done;
}
export async function putTransfer(transfer: Transfer): Promise<void> {
  const tx = (await open()).transaction('transfers', 'readwrite');
  const done = completed(tx);
  const records = await request<Transfer[]>(
    tx.objectStore('transfers').getAll(),
  );
  for (const record of records)
    if (record.expiresAt < Date.now())
      tx.objectStore('transfers').delete(record.nonce);
  tx.objectStore('transfers').put(transfer);
  await done;
}
export async function consumeTransfer(
  nonce: string,
  tabId: number,
): Promise<Transfer | undefined> {
  const tx = (await open()).transaction('transfers', 'readwrite');
  const done = completed(tx);
  const transfer = await request<Transfer | undefined>(
    tx.objectStore('transfers').get(nonce),
  );
  if (
    transfer &&
    transfer.expectedTabId === tabId &&
    transfer.expiresAt > Date.now()
  ) {
    tx.objectStore('transfers').delete(nonce);
    await done;
    return transfer;
  }
  await done;
  return undefined;
}

export async function putStartIntent(intent: StartIntent): Promise<void> {
  const tx = (await open()).transaction('control', 'readwrite');
  const done = completed(tx);
  tx.objectStore('control').put(intent, 'start-intent');
  await done;
}
export async function getStartIntent(): Promise<StartIntent | undefined> {
  return request(
    (await open())
      .transaction('control', 'readonly')
      .objectStore('control')
      .get('start-intent'),
  );
}
export async function consumeStartIntent(
  id: string,
): Promise<StartIntent | undefined> {
  const tx = (await open()).transaction('control', 'readwrite');
  const done = completed(tx);
  const intent = await request<StartIntent | undefined>(
    tx.objectStore('control').get('start-intent'),
  );
  if (intent?.id === id) {
    tx.objectStore('control').delete('start-intent');
    await done;
    return intent.expiresAt > Date.now() ? intent : undefined;
  }
  await done;
  return undefined;
}
