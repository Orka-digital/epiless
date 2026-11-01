import { vi } from 'vitest';

const memory = vi.hoisted(() => {
  const jobs = new Map<string, any>();
  const control = new Map<string, any>();
  return {
    jobs,
    control,
    store: {
      listJobs: vi.fn(async () => structuredClone([...jobs.values()])),
      getJob: vi.fn(async (id: string) =>
        jobs.has(id) ? structuredClone(jobs.get(id)) : undefined,
      ),
      mutateJob: vi.fn(async (id: string, update: (job: any) => void) => {
        const job = jobs.get(id);
        if (!job) return;
        update(job);
        return structuredClone(job);
      }),
      createJob: vi.fn(async (job: any) => {
        jobs.set(job.id, structuredClone(job));
      }),
      resumeLease: vi.fn(async () => undefined),
      deleteJob: vi.fn(async (id: string) => {
        jobs.delete(id);
      }),
      putTransfer: vi.fn(async () => undefined),
      consumeTransfer: vi.fn(async () => undefined),
      putStartIntent: vi.fn(async (value: any) => {
        control.set('start', structuredClone(value));
      }),
      getStartIntent: vi.fn(async () => control.get('start')),
      consumeStartIntent: vi.fn(async () => {
        const value = control.get('start');
        control.delete('start');
        return value;
      }),
      applyRetention: vi.fn(async () => undefined),
      getHistorySettings: vi.fn(async () => ({
        schemaVersion: 1,
        detailRetentionDays: 90,
      })),
      setHistorySettings: vi.fn(async () => undefined),
      deleteHistory: vi.fn(async () => undefined),
      getScanPreferences: vi.fn(async () => ({
        mode: 'AUTONOMOUS',
        viewportSeconds: 30,
      })),
      setScanPreferences: vi.fn(async () => undefined),
      getPendingRecheck: vi.fn(async () => control.get('recheck')),
      setPendingRecheck: vi.fn(async (value: any) => {
        control.set('recheck', value);
      }),
    },
  };
});

export function event() {
  const listeners: Array<(...args: any[]) => any> = [];
  return {
    listeners,
    addListener: vi.fn((listener: (...args: any[]) => any) => {
      listeners.push(listener);
    }),
    removeListener: vi.fn((listener: (...args: any[]) => any) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    }),
    emit: (...args: any[]) =>
      listeners.forEach((listener) => listener(...args)),
  };
}

export function fixtureMemory() {
  return memory;
}
