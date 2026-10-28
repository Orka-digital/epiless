import { describe, expect, it } from 'vitest';

import { trustedTransferSender } from '../../apps/chrome-extension/src/runner-policy';

describe('hosted upload handoff', () => {
  it('accepts only the configured exact origin and publish path with a browser tab', () => {
    expect(
      trustedTransferSender(
        { url: 'http://localhost:4321/publish', tab: { id: 5 } },
        'http://localhost:4321',
      ),
    ).toBe(true);
    expect(
      trustedTransferSender(
        { url: 'http://localhost:4322/publish', tab: { id: 5 } },
        'http://localhost:4321',
      ),
    ).toBe(false);
    expect(
      trustedTransferSender(
        { url: 'http://localhost:4321/publish-evil', tab: { id: 5 } },
        'http://localhost:4321',
      ),
    ).toBe(false);
    expect(
      trustedTransferSender(
        { url: 'https://localhost.attacker.test/publish', tab: { id: 5 } },
        'http://localhost:4321',
      ),
    ).toBe(false);
    expect(
      trustedTransferSender(
        { url: 'http://localhost:4321/publish' },
        'http://localhost:4321',
      ),
    ).toBe(false);
  });
});
