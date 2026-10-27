import { describe, expect, it, vi } from 'vitest';
import {
  reopenCaptureSource,
  waitForCaptureRelease,
} from '../../apps/chrome-extension/src/capture-source';

const viewport = { width: 600, height: 507, dpr: 2 };
function fixture() {
  const events: string[] = [];
  return {
    events,
    guard: vi.fn(async () => {
      events.push('guard');
    }),
    stop: vi.fn(async () => {
      events.push('stop');
    }),
    released: vi.fn(async () => {
      events.push('released');
      return true;
    }),
    token: vi.fn(async () => {
      events.push('token');
      return 'new-single-use-token';
    }),
    start: vi.fn(async () => {
      events.push('start');
    }),
    cancel: vi.fn(async () => {
      events.push('cancel');
    }),
    wait: vi.fn(async () => {
      events.push('wait');
    }),
  };
}
describe('native source replacement between measured segments', () => {
  it('waits for Chrome release and obtains a fresh one-use token for exact target geometry', async () => {
    const driver = fixture();
    driver.released.mockResolvedValueOnce(false);
    expect(await reopenCaptureSource(viewport, driver, 'source-2')).toBe(
      'source-2',
    );
    expect(driver.events).toEqual([
      'guard',
      'stop',
      'guard',
      'wait',
      'guard',
      'released',
      'guard',
      'token',
      'guard',
      'start',
      'guard',
    ]);
    expect(driver.token).toHaveBeenCalledOnce();
    expect(driver.start).toHaveBeenCalledWith(
      'new-single-use-token',
      'source-2',
      viewport,
    );
    expect(driver.cancel).not.toHaveBeenCalled();
  });
  it('does not consume a token after cancellation or lost authority', async () => {
    const driver = fixture();
    driver.token.mockImplementation(async () => {
      driver.guard.mockRejectedValue(new Error('PERMISSION_REVOKED'));
      return 'unused-token';
    });
    await expect(
      reopenCaptureSource(viewport, driver, 'source-2'),
    ).rejects.toThrow('PERMISSION_REVOKED');
    expect(driver.start).not.toHaveBeenCalled();
    expect(driver.cancel).not.toHaveBeenCalled();
  });
  it('cleans only the replacement source if stop arrives during startup', async () => {
    const driver = fixture();
    driver.start.mockImplementation(async () => {
      driver.guard.mockRejectedValue(new Error('RUNNER_CANCELLED'));
    });
    await expect(
      reopenCaptureSource(viewport, driver, 'source-2'),
    ).rejects.toThrow('RUNNER_CANCELLED');
    expect(driver.cancel).toHaveBeenCalledExactlyOnceWith('source-2');
    expect(driver.token).toHaveBeenCalledOnce();
  });
  it('bounds release waiting without reusing a previous token or retrying a refused authorization', async () => {
    const driver = fixture();
    driver.released.mockResolvedValue(false);
    await expect(reopenCaptureSource(viewport, driver)).rejects.toThrow(
      'CAPTURE_SOURCE_RELEASE_TIMEOUT',
    );
    expect(driver.released).toHaveBeenCalledTimes(40);
    expect(driver.token).not.toHaveBeenCalled();
    const denied = fixture();
    denied.token.mockRejectedValue(new Error('activeTab permission absent'));
    await expect(reopenCaptureSource(viewport, denied)).rejects.toThrow(
      'activeTab permission absent',
    );
    expect(denied.token).toHaveBeenCalledOnce();
    expect(denied.start).not.toHaveBeenCalled();
  });
});

// Cleanup uses source-lease authority, not the cancelled job's run permission.
describe('source release during terminal cleanup', () => {
  it('waits for the browser producer to release before restoration can run', async () => {
    let active = true;
    const released = vi.fn(async () => !active);
    let resumed = false;
    const cleanup = waitForCaptureRelease({
      guard: async () => undefined,
      released,
      wait: async () => {
        expect(resumed).toBe(false);
        active = false;
      },
    }).then(() => {
      resumed = true;
    });
    expect(resumed).toBe(false);
    await cleanup;
    expect(released).toHaveBeenCalledTimes(2);
    expect(resumed).toBe(true);
  });
  it('aborts cleanup if a different source lease takes ownership', async () => {
    const released = vi.fn(async () => false);
    let generation = 'old';
    await expect(
      waitForCaptureRelease({
        guard: async () => {
          if (generation !== 'old')
            throw new Error('CAPTURE_SOURCE_CHANGED_DURING_RELEASE');
        },
        released,
        wait: async () => {
          generation = 'new';
        },
      }),
    ).rejects.toThrow('CAPTURE_SOURCE_CHANGED_DURING_RELEASE');
    expect(released).toHaveBeenCalledOnce();
  });
});
