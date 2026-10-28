import { viewportDuration, type ScanMode } from './model';
import {
  readPendingRecheck,
  readScanPreferences,
  readStartIntent,
  type PendingRecheck,
  type StartIntent,
} from './store-control-schema';
import { completed, open, request } from './store-db';

/** Read and validate the exact local recheck target; malformed records cannot authorize scanning. */
export async function getPendingRecheck(): Promise<PendingRecheck | undefined> {
  return readPendingRecheck(
    await request<unknown>(
      (await open())
        .transaction('control', 'readonly')
        .objectStore('control')
        .get('pending-recheck'),
    ),
  );
}

/** Persist or clear the single pending recheck only after its transaction commits. */
export async function setPendingRecheck(
  value: PendingRecheck | undefined,
): Promise<void> {
  const tx = (await open()).transaction('control', 'readwrite');
  const done = completed(tx);
  if (value) tx.objectStore('control').put(value, 'pending-recheck');
  else tx.objectStore('control').delete('pending-recheck');
  await done;
}

/** Read validated capture preferences with bounded defaults for missing or corrupt records. */
export async function getScanPreferences(): Promise<{
  mode: ScanMode;
  viewportSeconds: number;
}> {
  return readScanPreferences(
    await request<unknown>(
      (await open())
        .transaction('control', 'readonly')
        .objectStore('control')
        .get('scan-preferences'),
    ),
  );
}

/** Validate mode and duration before committing local capture preferences. */
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

/** Persist a short-lived start intent; starting still requires permission and tab identity checks. */
export async function putStartIntent(intent: StartIntent): Promise<void> {
  const tx = (await open()).transaction('control', 'readwrite');
  const done = completed(tx);
  tx.objectStore('control').put(intent, 'start-intent');
  await done;
}

/** Validate stored start authorization before exposing it to the runner. */
export async function getStartIntent(): Promise<StartIntent | undefined> {
  return readStartIntent(
    await request<unknown>(
      (await open())
        .transaction('control', 'readonly')
        .objectStore('control')
        .get('start-intent'),
    ),
  );
}

/** Consume the matching validated intent once; expired identities cannot start capture. */
export async function consumeStartIntent(
  id: string,
): Promise<StartIntent | undefined> {
  const tx = (await open()).transaction('control', 'readwrite');
  const done = completed(tx);
  const intent = readStartIntent(
    await request<unknown>(tx.objectStore('control').get('start-intent')),
  );
  if (intent?.id === id) {
    tx.objectStore('control').delete('start-intent');
    await done;
    return intent.expiresAt > Date.now() ? intent : undefined;
  }
  await done;
  return undefined;
}
