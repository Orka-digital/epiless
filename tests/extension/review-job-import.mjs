/** Populate isolated test IndexedDB after genuine extension startup has initialized it.
 * @param {import('@playwright/test').Page} dashboard
 * @param {import('../../apps/chrome-extension/src/model').ScanJob[]} jobs
 */
export function importReviewJobs(dashboard, jobs) {
  return dashboard.evaluate(
    (values) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('flashguard-audit-v1');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('jobs', 'readwrite');
          for (const job of values) tx.objectStore('jobs').put(job);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    jobs,
  );
}
