const DATABASE = 'flashguard-audit-v1';
let database: Promise<IDBDatabase> | undefined;

/** Open the versioned IndexedDB store with additive upgrades; preserve existing jobs. */
export function open(): Promise<IDBDatabase> {
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

/** Resolve one IndexedDB request without changing its enclosing transaction lifetime. */
export function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

/** Observe commit or abort before reporting a mutation as durable. */
export function completed(transaction: IDBTransaction): Promise<void> {
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
