import { type Transfer } from './model';
import { completed, open, request } from './store-db';

/** Store a tab-bound transfer and remove expired transfer records transactionally. */
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

/** Consume an unexpired transfer only for its expected tab; mismatches leave the transfer untouched. */
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
