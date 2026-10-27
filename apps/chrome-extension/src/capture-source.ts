import type { CaptureViewport } from './capture-quality';

export interface CaptureSourceDriver {
  guard(): Promise<unknown>;
  stop(): Promise<unknown>;
  released(): Promise<boolean>;
  token(): Promise<string>;
  start(
    streamId: string,
    sourceId: string,
    viewport: CaptureViewport,
  ): Promise<unknown>;
  cancel(sourceId: string): Promise<unknown>;
  wait(ms: number): Promise<void>;
}

/** Chrome's producer can outlive track.stop() briefly. Geometry must not be
 * changed or remembered while its old auto-size constraints are still active. */
export async function waitForCaptureRelease(
  driver: Pick<CaptureSourceDriver, 'guard' | 'released' | 'wait'>,
): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    await driver.guard();
    if (await driver.released()) return;
    await driver.wait(50);
  }
  throw new Error('CAPTURE_SOURCE_RELEASE_TIMEOUT');
}

/** A tab stream token is single-use. Stop the old producer at a segment boundary
 * and obtain a fresh token under the existing tab authority. Never resize pixels
 * to disguise a source that cannot deliver the requested native geometry. */
export async function reopenCaptureSource(
  viewport: CaptureViewport,
  driver: CaptureSourceDriver,
  sourceId = crypto.randomUUID(),
): Promise<string> {
  await driver.guard();
  await driver.stop();
  await waitForCaptureRelease(driver);
  await driver.guard();
  const streamId = await driver.token();
  // A cancellation between token creation and consumption leaves the unused
  // browser token to expire; it must never be consumed after permission ends.
  await driver.guard();
  try {
    await driver.start(streamId, sourceId, viewport);
    await driver.guard();
    return sourceId;
  } catch (error) {
    await driver.cancel(sourceId).catch(() => undefined);
    throw error;
  }
}
