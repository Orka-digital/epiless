import { TERMINAL_STATES, type ScanJob, type Transfer } from './model';
import { type PendingRecheck, type StartIntent } from './store-control-schema';
import { completed, open, request } from './store-db';

/** Read local jobs newest first without changing their persisted ownership or evidence. */
export async function listJobs(): Promise<ScanJob[]> {
  const tx = (await open()).transaction('jobs', 'readonly');
  return (await request<ScanJob[]>(tx.objectStore('jobs').getAll())).sort(
    (a, b) => b.startedAt.localeCompare(a.startedAt),
  );
}

/** Read one stored job by its exact identifier; missing records remain undefined. */
export async function getJob(id: string): Promise<ScanJob | undefined> {
  return request(
    (await open()).transaction('jobs', 'readonly').objectStore('jobs').get(id),
  );
}

/** Apply one mutation transactionally; failures abort and terminal states release only their own active lease. */
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

/** Acquire the active-job lease and store its initial state in the same transaction. */
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

/** Resume only paused/interrupted work; reset interrupted tasks while retaining prior observations. */
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

/** Delete one inactive job and its dependent transfers without disturbing another active lease. */
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

/** Delete selected jobs and transfers atomically; an active lease blocks deletion. */
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
