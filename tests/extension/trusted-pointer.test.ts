import { describe, it, expect, vi } from 'vitest';
import {
  attachPointerSession,
  detachPointerSession,
  detachPointerSessionAndConfirm,
  releaseOwnedPointerSession,
  trustedHover,
  type PointerDriver,
} from '../../apps/chrome-extension/src/trusted-pointer';

function fixture() {
  const driver: PointerDriver = {
    targets: vi.fn(async () => []),
    attach: vi.fn(async () => {}),
    move: vi.fn(async () => {}),
    detach: vi.fn(async () => {}),
  };
  const request = vi.fn(async (type: string) =>
    type === 'FG_POINTER_CONFIRM'
      ? { achieved: true, state: 'hover:accordion:false:false' }
      : { achieved: true, x: 20, y: 30 },
  );
  return {
    enabled: true,
    tabId: 7,
    target: { kind: 'accordion' as const, selectorPath: ['*:nth-child(1)'] },
    guard: vi.fn(async () => {}),
    driver,
    request,
  };
}
describe('trusted pointer isolation', () => {
  it('retains ownership after auth-abort detach failure and clears it only after a confirmed retry', async () => {
    const input = fixture();
    const session = { tabId: input.tabId, generation: 'auth-before-runJob' };
    let owner: typeof session | undefined = session;
    let persistent = session;
    const intentional = new Set<typeof session>();
    const forget = vi.fn(async () => {
      persistent = undefined!;
      owner = undefined;
    });
    vi.mocked(input.driver.targets).mockResolvedValue([
      { tabId: input.tabId, attached: true },
    ]);
    vi.mocked(input.driver.detach).mockImplementation(async () => {
      // The onDetach listener can suppress intended events without deleting
      // ownership. An API error must leave the authorization lease recoverable.
      expect(owner).toBe(session);
      expect(intentional.has(session)).toBe(true);
      throw new Error('Detach failed');
    });
    const options = {
      session,
      current: () => owner,
      intentional,
      forget,
      driver: input.driver,
    };
    await expect(releaseOwnedPointerSession(options)).rejects.toThrow(
      'DEBUGGER_RELEASE_UNCONFIRMED',
    );
    expect(owner).toBe(session);
    expect(persistent).toBe(session);
    expect(forget).not.toHaveBeenCalled();
    expect(intentional.size).toBe(0);
    vi.mocked(input.driver.detach).mockResolvedValue(undefined);
    vi.mocked(input.driver.targets).mockResolvedValue([]);
    await releaseOwnedPointerSession(options);
    expect(owner).toBeUndefined();
    expect(persistent).toBeUndefined();
    expect(forget).toHaveBeenCalledOnce();
  });
  it('does not forget a newer lease or a lease whose persistent cleanup failed', async () => {
    const input = fixture();
    const old = { tabId: input.tabId, generation: 'old' },
      newer = { tabId: input.tabId, generation: 'new' };
    let owner = old;
    const intentional = new Set<typeof old>();
    const forget = vi.fn(async () => {
      throw new Error('STORAGE_FAILED');
    });
    const options = {
      session: old,
      current: () => owner,
      intentional,
      forget,
      driver: input.driver,
    };
    await expect(releaseOwnedPointerSession(options)).rejects.toThrow(
      'STORAGE_FAILED',
    );
    expect(owner).toBe(old);
    expect(intentional.size).toBe(0);
    forget.mockClear();
    vi.mocked(input.driver.detach).mockImplementation(async () => {
      owner = newer;
    });
    await expect(releaseOwnedPointerSession(options)).rejects.toThrow(
      'DEBUGGER_RELEASE_OWNERSHIP_CHANGED',
    );
    expect(owner).toBe(newer);
    expect(forget).not.toHaveBeenCalled();
  });
  it('confirms terminal release even if already detached, and rejects an attachment that remains', async () => {
    const input = fixture();
    vi.mocked(input.driver.detach).mockRejectedValue(
      new Error('Not attached by this extension'),
    );
    await expect(
      detachPointerSessionAndConfirm(input.tabId, input.driver),
    ).resolves.toBeUndefined();
    vi.mocked(input.driver.targets).mockResolvedValue([
      { tabId: input.tabId, attached: true },
    ]);
    await expect(
      detachPointerSessionAndConfirm(input.tabId, input.driver),
    ).rejects.toThrow('DEBUGGER_RELEASE_UNCONFIRMED');
    expect(input.driver.attach).not.toHaveBeenCalled();
  });
  it('reuses a job-owned attachment without toggling browser chrome around each measured hover', async () => {
    const input = fixture();
    await attachPointerSession(input.tabId, input.driver);
    expect(
      (await trustedHover({ ...input, ownsDebuggerSession: true })).achieved,
    ).toBe(true);
    expect(
      (await trustedHover({ ...input, ownsDebuggerSession: true })).achieved,
    ).toBe(true);
    expect(input.driver.attach).toHaveBeenCalledOnce();
    expect(input.driver.detach).not.toHaveBeenCalled();
    await detachPointerSession(input.tabId, input.driver);
    expect(input.driver.detach).toHaveBeenCalledOnce();
  });
  it('requires explicit advanced opt-in before accessing the debugger', async () => {
    const input = fixture();
    input.enabled = false;
    expect((await trustedHover(input)).reason).toBe(
      'TRUSTED_POINTER_DRIVER_NOT_ENABLED',
    );
    expect(input.driver.targets).not.toHaveBeenCalled();
  });
  it('never displaces a user debugger and never detaches someone else', async () => {
    const input = fixture();
    input.driver.targets = vi.fn(async () => [{ tabId: 7, attached: true }]);
    expect((await trustedHover(input)).reason).toBe(
      'DEBUGGER_ALREADY_ATTACHED',
    );
    expect(input.driver.attach).not.toHaveBeenCalled();
    expect(input.driver.detach).not.toHaveBeenCalled();
  });
  it('moves the real pointer only after rechecking geometry and confirms native hover', async () => {
    const input = fixture();
    expect((await trustedHover(input)).achieved).toBe(true);
    expect(input.request.mock.calls.map(([type]) => type)).toEqual([
      'FG_POINTER_TARGET',
      'FG_POINTER_TARGET',
      'FG_POINTER_CONFIRM',
    ]);
    expect(input.driver.move).toHaveBeenCalledWith(7, 20, 30);
    expect(input.driver.detach).toHaveBeenCalledOnce();
  });
  it('detaches on cancellation after attaching without sending pointer input', async () => {
    const input = fixture();
    input.guard
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('RUNNER_CANCELLED'));
    expect((await trustedHover(input)).reason).toContain('RUNNER_CANCELLED');
    expect(input.driver.move).not.toHaveBeenCalled();
    expect(input.driver.detach).toHaveBeenCalledOnce();
  });
  it('fails closed when geometry or actual hovered state cannot be confirmed', async () => {
    const input = fixture();
    input.request = vi.fn(async () => ({ achieved: false, x: NaN, y: 0 }));
    expect((await trustedHover(input)).achieved).toBe(false);
    expect(input.driver.move).not.toHaveBeenCalled();
  });
});
