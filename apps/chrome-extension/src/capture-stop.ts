import { TERMINAL_STATES, type ScanJob } from './model';

/** A stale dashboard request must never stop another job's native producer. */
export async function stopRequestedCapture(options: {
  id: string;
  type: 'STOP' | 'PAUSE';
  running: boolean;
  now(): string;
  mutate(
    id: string,
    update: (job: ScanJob) => void,
  ): Promise<ScanJob | undefined>;
  cancel(tabId: number): Promise<unknown>;
  stop(generation: string): Promise<unknown>;
}): Promise<void> {
  let changed = false;
  const stopped = await options.mutate(options.id, (job) => {
    if (TERMINAL_STATES.includes(job.state)) return;
    changed = true;
    job.stopIntent = true;
    job.stopReason = options.type === 'PAUSE' ? 'USER_PAUSE' : 'USER_STOP';
    job.state =
      options.type === 'PAUSE'
        ? 'PAUSED'
        : options.running
          ? 'STOPPING'
          : 'PARTIAL';
    if (job.state === 'PARTIAL') job.endedAt = options.now();
  });
  if (!changed || !stopped) return;
  // Dispatch the generation-scoped producer stop first. An unresponsive page
  // must neither prolong capture nor keep the STOP/PAUSE reply waiting forever.
  const capture = options.stop(stopped.generation).catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.all([
      capture,
      Promise.race([
        options.cancel(stopped.tabId).catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 1000);
        }),
      ]),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
