import { describe, expect, it } from 'vitest';

import { createDisposableScan } from '../../apps/chrome-extension/src/disposable-scan';
import { intent, storage } from './disposable-scan.fixture';
describe('disposable scan creation', () => {
  it.each(['replaced', 'cleared'] as const)(
    'keeps a receipt locally without restoring stale ownership when storage was %s during creation',
    async (change) => {
      const state = storage(),
        foreign = { ...intent(), nonce: 'newer-owner' };
      const result = await createDisposableScan({
        owner: intent(),
        ...state,
        create: async () => {
          state.replace(change === 'replaced' ? foreign : undefined);
          return { tabId: 40, windowId: 2 };
        },
      });
      expect(result).toMatchObject({
        phase: 'MANUAL',
        scanTabId: 40,
        scanWindowId: 2,
      });
      expect(state.stored).toEqual(change === 'replaced' ? foreign : undefined);
    },
  );
});
