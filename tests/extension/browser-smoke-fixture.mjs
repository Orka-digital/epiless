export const send = (page, message) =>
  page.evaluate((value) => chrome.runtime.sendMessage(value), message);

export async function storeJob(page, job, active) {
  await page.evaluate(
    ({ job, active }) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('flashguard-audit-v1');
        request.onsuccess = () => {
          const tx = request.result.transaction(
            ['jobs', 'control'],
            'readwrite',
          );
          tx.objectStore('jobs').put(job);
          if (active) tx.objectStore('control').put(job.id, 'active');
          tx.oncomplete = () => resolve(undefined);
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
    { job, active },
  );
}

export function fixture(id, state) {
  return {
    id,
    tabId: 9999,
    origin: 'https://example.test',
    startUrl: 'https://example.test/',
    startedAt: '2026-10-26T12:00:00Z',
    updatedAt: '2026-10-26T12:00:00Z',
    state,
    stopIntent: state === 'PAUSED',
    generation: id + '-lease',
    elapsedMs: 0,
    mode: 'AUTONOMOUS',
    skippedLinks: 0,
    limitations: [],
    limits: {
      maxRoutes: 50,
      maxDepth: 4,
      maxDurationMs: 1200000,
      maxActionsPerRoute: 12,
    },
    tasks: [
      {
        id: 'home',
        url: 'https://example.test/',
        depth: 0,
        state: 'QUEUED',
        observations: [],
        reasons: [],
      },
    ],
  };
}
