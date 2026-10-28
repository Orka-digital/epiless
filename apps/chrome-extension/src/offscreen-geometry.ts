import { type CaptureViewport } from './capture-quality';

import { captureState } from './offscreen-state';

/** Validate decoded source dimensions against the requested viewport before accepting segment frames. */
export async function negotiateViewport(
  viewport: CaptureViewport | undefined,
): Promise<void> {
  if (!viewport) return;
  const revision = captureState.captureRevision;
  const width = Math.round(viewport.width * viewport.dpr),
    height = Math.round(viewport.height * viewport.dpr);
  const track = captureState.stream?.getVideoTracks()[0];
  if (!track) throw new Error('Capture track is unavailable');
  try {
    await track.applyConstraints({
      width: { exact: width },
      height: { exact: height },
      frameRate: { ideal: 60, max: 60 },
      resizeMode: { exact: 'none' },
    } as MediaTrackConstraints);
  } catch (error) {
    // Keep just geometry/cadence capabilities. Never include device/group IDs
    // from the browser's full settings/capabilities objects in a report.
    const settings = track.getSettings();
    const capabilities = track.getCapabilities?.();
    const details = {
      requested: { width, height, resizeMode: 'none' },
      constraint:
        typeof (error as { constraint?: unknown })?.constraint === 'string'
          ? String((error as { constraint: string }).constraint).slice(0, 80)
          : 'UNKNOWN',
      settings: {
        width: settings.width,
        height: settings.height,
        frameRate: settings.frameRate,
        resizeMode: (settings as MediaTrackSettings & { resizeMode?: string })
          .resizeMode,
      },
      capabilities: {
        width: capabilities?.width,
        height: capabilities?.height,
        frameRate: capabilities?.frameRate,
        resizeMode: (
          capabilities as
            (MediaTrackCapabilities & { resizeMode?: string[] }) | undefined
        )?.resizeMode,
      },
      decoded: captureState.lastDecodedGeometry,
    };
    throw new Error(
      `CAPTURE_VIEWPORT_CONSTRAINT_FAILED: ${JSON.stringify(details)}; ${String(error).slice(0, 200)}`,
      { cause: error },
    );
  }
  if (revision !== captureState.captureRevision)
    throw new Error('CAPTURE_SOURCE_CHANGED_DURING_NEGOTIATION');
  if (
    captureState.lastDecodedGeometry?.width === width &&
    captureState.lastDecodedGeometry.height === height
  )
    return;
  // Let already queued frames with the previous geometry drain before BEGIN.
  // A quiet/static source may deliver no next frame: the normal coverage and
  // per-frame geometry guards then retain an explicitly inconclusive segment.
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      if (captureState.geometryWaiter?.resolve === finish)
        captureState.geometryWaiter = undefined;
      resolve();
    };
    const timer = setTimeout(finish, 1500);
    captureState.geometryWaiter = { width, height, resolve: finish };
  });
  if (revision !== captureState.captureRevision)
    throw new Error('CAPTURE_SOURCE_CHANGED_DURING_NEGOTIATION');
}
