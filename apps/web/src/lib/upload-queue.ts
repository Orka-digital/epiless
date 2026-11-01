import type { AuditReport } from '@epi-less/core';
import { contentHash } from '@epi-less/core/serialization';

type UploadState =
  'QUEUED' | 'VERIFY' | 'RETRY' | 'PAUSED' | 'COMPLETE' | 'CANCELLED';
export interface PublicationResult {
  id: string;
  shareUrl?: string;
  visibility: string;
  state?: string;
}
export interface UploadJob {
  id: string;
  accountId: string;
  accountName: string;
  report: AuditReport;
  contentHash: string;
  visibility: string;
  idempotencyKey: string;
  approvedAt: number;
  state: UploadState;
  attempts: number;
  retryAt: number;
  lastError?: string;
  intentId?: string;
  publication?: PublicationResult;
}
type JobUpdate = Pick<
  Partial<UploadJob>,
  'state' | 'attempts' | 'retryAt' | 'lastError' | 'intentId' | 'publication'
>;

const DATABASE = 'flashguard-approved-uploads';
const STORE = 'jobs';
const MAX_JOBS = 25;

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error('De lokale uploadwachtrij kan niet worden geopend.'));
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore, set: (value: T) => void) => void,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let result: T;
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(
        new Error(
          'Opslaan in de lokale uploadwachtrij is mislukt. Controleer je beschikbare browseropslag; er wordt niets verstuurd zonder opgeslagen goedkeuring.',
        ),
      );
    };
    action(tx.objectStore(STORE), (value) => (result = value));
  });
}

/** Read durable local upload jobs without starting network work. */
export async function listUploads(): Promise<UploadJob[]> {
  const jobs = await transaction<UploadJob[]>('readonly', (store, set) => {
    const request = store.getAll();
    request.onsuccess = () => set(request.result as UploadJob[]);
  });
  return jobs.sort((a, b) => b.approvedAt - a.approvedAt);
}

/** Read one queued upload by identity; missing work stays absent. */
export function getUpload(id: string): Promise<UploadJob | undefined> {
  return transaction('readonly', (store, set) => {
    const request = store.get(id);
    request.onsuccess = () => set(request.result as UploadJob | undefined);
  });
}

/** Persist explicit approval for the exact preview before upload may begin. */
export async function approveUpload(input: {
  accountId: string;
  accountName: string;
  report: AuditReport;
  visibility: string;
}): Promise<UploadJob> {
  if (!input.accountId) throw new Error('Meld je eerst aan.');
  const { validatePublicReport } = await import('@epi-less/core');
  const report = structuredClone(validatePublicReport(input.report));
  if (new TextEncoder().encode(JSON.stringify(input.report)).length > 1048576)
    throw new Error('De geselecteerde snapshot mag maximaal 1 MiB groot zijn.');
  const id = crypto.randomUUID();
  const job: UploadJob = {
    id,
    accountId: input.accountId,
    accountName: input.accountName,
    report,
    contentHash: await contentHash(report),
    visibility: input.visibility,
    idempotencyKey: id,
    approvedAt: Date.now(),
    state: 'QUEUED',
    attempts: 0,
    retryAt: 0,
  };
  await transaction<void>('readwrite', (store) => {
    const count = store.count();
    count.onsuccess = () => {
      if (count.result >= MAX_JOBS) {
        store.transaction.abort();
        return;
      }
      store.add(job);
    };
  });
  return job;
}

/** Persist queue progress without transferring approval to different report content. */
export function updateUpload(
  id: string,
  update: JobUpdate,
): Promise<UploadJob | undefined> {
  return transaction('readwrite', (store, set) => {
    const request = store.get(id);
    request.onsuccess = () => {
      const job = request.result as UploadJob | undefined;
      if (!job) return set(undefined);
      // A late callback must not reactivate a cancelled or completed upload.
      if (
        ['CANCELLED', 'COMPLETE'].includes(job.state) &&
        update.state !== 'COMPLETE'
      )
        return set(job);
      const next = { ...job, ...update };
      store.put(next);
      set(next);
    };
  });
}

/** Remove only the selected local queue entry. */
export function forgetUpload(id: string): Promise<void> {
  return transaction('readwrite', (store) => {
    const request = store.get(id);
    request.onsuccess = () => {
      const job = request.result as UploadJob | undefined;
      if (job && ['COMPLETE', 'CANCELLED'].includes(job.state))
        store.delete(id);
    };
  });
}

/** Account deletion must not erase another account's local approved work. */
export async function clearAccountUploads(accountId: string): Promise<void> {
  await transaction<void>('readwrite', (store) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if ((cursor.value as UploadJob).accountId === accountId) cursor.delete();
      cursor.continue();
    };
  });
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('flashguard-upload-status');
    channel.postMessage('changed');
    channel.close();
  }
}

/** Reject queue work whose content or account no longer matches explicit approval. */
export async function assertApproved(job: UploadJob): Promise<void> {
  if ((await contentHash(job.report)) !== job.contentHash)
    throw new Error(
      'De lokaal bewaarde snapshot is gewijzigd. Annuleer deze opdracht en controleer een nieuwe preview.',
    );
}

/** No automatic request loop; each explicit retry respects this cooldown. */
export function retryDelay(attempts: number, retryAfterMs = 0): number {
  return Math.max(
    Math.min(300_000, 5_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 6)),
    retryAfterMs,
  );
}
