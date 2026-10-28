// Manual toolbar-capture gate. Static by default; optional tiny low-contrast motion.
// The opt-in candidate mode changes one 2 × 2 CSS-pixel signal. DENSE adds
// a separately disclosed low-contrast GPU workload during the control observation.
// Start this script, then use the real browser toolbar to authorise/start FlashGuard.

import { arch, cpus, platform, release } from 'node:os';

/** native Fixture Environment without changing retained fixture evidence. */
export async function nativeFixtureEnvironment({
  context,
  emulateViewport,
  windowWidth,
  windowHeight,
  initialGeometry,
  candidateState,
  geometry,
  pixelProbe,
  dashboard,
  denseFixture,
  candidateFixture,
  loopFixture,
  loopFixtureIdentity,
  loopDocuments,
  extensionBuild,
  encodedRecheckFixture,
  encodedRecheckModuleSha256,
  encodedAssets,
  encodedFixture,
  videoFixture,
  interactive,
  gentleMotion,
}) {
  return {
    browser: context.browser().version(),
    platform: process.platform,
    machine: {
      arch: arch(),
      os: platform(),
      release: release(),
      cpuModel: cpus()[0]?.model,
      logicalCpus: cpus().length,
    },
    recordedAt: new Date().toISOString(),
    emulateViewport,
    requestedWindow: { width: windowWidth, height: windowHeight },
    initialGeometry,
    finalGeometry: candidateState?.geometry ?? (await geometry()),
    pixelProbe: pixelProbe
      ? {
          instrumentation:
            'Temporary copied extension samples four static corners once per source geometry, adding first-frame overhead; production dist is unchanged.',
          expectedColors: [
            [40, 80, 120, 255],
            [140, 180, 220, 255],
            [80, 120, 160, 255],
            [180, 140, 100, 255],
          ],
          samples: await dashboard.evaluate(
            async () =>
              (await chrome.storage.local.get('fixturePixelProbes'))
                .fixturePixelProbes ?? [],
          ),
        }
      : null,
    denseProbe: denseFixture
      ? {
          instrumentation:
            'Temporary copied extension samples four corner RGB values on first/every29th submitted frame, at most120 samples, adding periodic readback overhead. No images retained. Production dist unchanged; timings include fixture instrumentation.',
          channelMinimum: 90,
          channelMaximum: 113,
          samples: await dashboard.evaluate(
            async () =>
              (await chrome.storage.local.get('fixturePixelProbes'))
                .fixturePixelProbes ?? [],
          ),
        }
      : null,
    ...(candidateFixture
      ? {
          candidateFixture: candidateState?.fixture,
        }
      : {}),
    ...(loopFixture
      ? {
          loopFixture: loopFixtureIdentity,
          loopDocuments: [...loopDocuments.values()],
        }
      : {}),
    extensionBuild,
    ...(encodedRecheckFixture
      ? {
          encodedRecheck: {
            moduleSha256: encodedRecheckModuleSha256,
            ...encodedRecheckFixture.snapshot(),
          },
        }
      : {}),
    ...(encodedAssets
      ? {
          encodedSource: {
            manifestSha256: encodedAssets.manifestSha256,
            manifest: encodedAssets.manifest,
          },
        }
      : {}),
    fixture: loopFixture
      ? 'An existing finite muted looping video displays only the immutable constant grey35 fixed.webm VP9 control at64×64 CSS pixels. No autoplay, flashes, audio or canvas media source. The autonomous supported media action starts playback; the runner seeks near the existing end and measures real currentTime and rVFC wraps. A4px low-contrast point moves slowly for capture cadence. Independent bounded page metadata survives document reloads through the localhost fixture collector; no raw frames are retained.'
      : encodedFixture
        ? 'A real muted 2×2 CSS-pixel HTML video plays a pre-encoded lossless VP9/WebM file only after a supported disclosure. Before capture, all 53 decoded RGBA frames and PTS are checked against the grey35/125 2.08s signal plus grey35 end-frame. No audio, canvas media source, large flashing area or automatic signal playback. rVFC is presentation evidence; expected decoded RGB is not assumed to prove browser colour output.'
        : videoFixture
          ? 'A real muted 2×2 CSS-pixel HTML video presents a detached canvas.captureStream source, grey35/125 for2.08s after disclosure; no encoded media file and no audio. Ground truth records source draws separately from actual requestVideoFrameCallback presentation clocks.' +
            (denseFixture
              ? ' A full-viewport WebGL2 background changes for5s after the same control, with all RGB channels bounded to90–113; draw timestamps are recorded independently of capture.'
              : '')
          : candidateFixture
            ? 'A 2×2 CSS-pixel marker alternates between grey35 and grey125 for 2.08s after a supported disclosure control; fixed mode keeps grey35. Other content static with one slow low-contrast cadence marker. No audio.'
            : interactive
              ? 'static DOM menu/tab/carousel/consent, muted grey canvas-stream video, pushState links, redirect and lazy growth; no flashing/audio'
              : gentleMotion
                ? 'static content plus low-contrast 4px marker moving slowly without flashes'
                : 'static, no animation/audio',
    headless: false,
  };
}
