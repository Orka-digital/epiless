import { describe, expect, it } from 'vitest';

import {
  emulateCapturedViewport,
  restoreEmulatedViewport,
} from '../../apps/chrome-extension/src/viewport-driver';

import { expected, fixture, original } from './viewport-driver.fixture';
describe('responsive viewport driver', () => {
  it('never changes geometry after a stop guard or mismatched device scale', async () => {
    const stopped = fixture();
    stopped.guard.mockRejectedValueOnce(new Error('STOPPED'));
    await expect(emulateCapturedViewport(stopped)).rejects.toThrow('STOPPED');
    expect(stopped.driver.command).not.toHaveBeenCalled();
    const scaled = fixture();
    scaled.expected = { ...expected, dpr: 1 };
    await expect(emulateCapturedViewport(scaled)).rejects.toThrow(
      'VIEWPORT_DPR_MISMATCH',
    );
    expect(scaled.driver.command).not.toHaveBeenCalled();
  });

  it('rejects unsupported dimensions before mutating the browser', async () => {
    const input = fixture();
    input.expected = { ...expected, width: 100 };
    await expect(emulateCapturedViewport(input)).rejects.toThrow(
      'CDP_VIEWPORT_OUTSIDE_SUPPORTED_BOUNDS',
    );
    expect(input.driver.command).not.toHaveBeenCalled();
  });

  it('clears metrics without leaving another visible-size override and reports a failed cleanup', async () => {
    const input = fixture();
    await restoreEmulatedViewport(3, original, input.driver);
    expect(input.driver.command).toHaveBeenCalledOnce();
    expect(input.driver.command).toHaveBeenLastCalledWith(
      3,
      'Emulation.clearDeviceMetricsOverride',
    );
    input.driver.command.mockRejectedValueOnce(new Error('TARGET_CHANGED'));
    await expect(
      restoreEmulatedViewport(3, original, input.driver),
    ).rejects.toThrow('TARGET_CHANGED');
    expect(input.driver.command).toHaveBeenLastCalledWith(
      3,
      'Emulation.clearDeviceMetricsOverride',
    );
  });
});
