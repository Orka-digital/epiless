// Manual toolbar-capture gate. Static by default; optional tiny low-contrast motion.
// The opt-in candidate mode changes one 2 × 2 CSS-pixel signal. DENSE adds
// a separately disclosed low-contrast GPU workload during the control observation.
// Start this script, then use the real browser toolbar to authorise/start FlashGuard.

import { readFile, writeFile } from 'node:fs/promises';

import { createHash } from 'node:crypto';

import { NativeEncodedRecheckFixture } from './native-encoded-recheck-source.mjs';

import { nativeLoopPage } from './native-loop-page.mjs';

import {
  LOOP_CADENCE_POLICY,
  nativeLoopCadencePage,
} from './native-loop-cadence-page.mjs';

import {
  encodedPageSource,
  loadNativeEncodedAssets,
} from './native-encoded-source.mjs';

import path from 'node:path';

/** Parse fixture arguments and validate supported capture modes before starting local resources. */
export async function configureNativeFixture({ evidence }) {
  const gentleMotion = process.env.EPI_LESS_FIXTURE_MOTION === '1';
  const interactive = process.env.EPI_LESS_FIXTURE_INTERACTIVE === '1';
  const pixelProbe = process.env.EPI_LESS_FIXTURE_PIXEL_PROBE === '1';
  const videoFixture = process.env.EPI_LESS_FIXTURE_VIDEO === '1';
  const denseFixture = process.env.EPI_LESS_FIXTURE_DENSE === '1';
  const encodedFixture = process.env.EPI_LESS_FIXTURE_ENCODED === '1';
  const encodedRecheck = process.env.EPI_LESS_FIXTURE_ENCODED_RECHECK === '1';
  const loopFixture = process.env.EPI_LESS_FIXTURE_LOOP === '1';
  const loopCadence = process.env.EPI_LESS_FIXTURE_LOOP_CADENCE === '1';
  if (encodedRecheck && (!encodedFixture || loopFixture))
    throw new Error('ENCODED_RECHECK requires ENCODED=1 and cannot use LOOP.');
  if (loopCadence && (!loopFixture || !encodedFixture))
    throw new Error('LOOP_CADENCE requires LOOP=1 and ENCODED=1.');
  if (loopFixture && !encodedFixture)
    throw new Error(
      'LOOP requires ENCODED=1 and always uses the immutable fixed control.',
    );
  if (
    encodedFixture &&
    (videoFixture || denseFixture || pixelProbe || interactive)
  )
    throw new Error(
      'ENCODED is a separate fixture; do not combine it with VIDEO, DENSE, PIXEL_PROBE or INTERACTIVE.',
    );
  const encodedAssets = encodedFixture
    ? await loadNativeEncodedAssets(process.env.EPI_LESS_FIXTURE_ENCODED_DIR)
    : undefined;
  const encodedRecheckFixture = encodedRecheck
    ? new NativeEncodedRecheckFixture(encodedAssets)
    : undefined;
  const encodedRecheckModuleSha256 = encodedRecheck
    ? createHash('sha256')
        .update(
          await readFile(
            new URL('./native-encoded-recheck-source.mjs', import.meta.url),
          ),
        )
        .digest('hex')
    : undefined;
  const loopDocuments = new Map();
  const loopHtml = loopFixture
    ? (loopCadence ? nativeLoopCadencePage : nativeLoopPage)(
        encodedPageSource(encodedAssets, true),
      )
    : undefined;
  const loopFixtureIdentity = loopFixture
    ? {
        pageModuleSha256: createHash('sha256')
          .update(
            await readFile(new URL('./native-loop-page.mjs', import.meta.url)),
          )
          .digest('hex'),
        servedHtmlSha256: createHash('sha256').update(loopHtml).digest('hex'),
        ...(loopCadence
          ? {
              cadenceVariant: {
                moduleSha256: createHash('sha256')
                  .update(
                    await readFile(
                      new URL(
                        './native-loop-cadence-page.mjs',
                        import.meta.url,
                      ),
                    ),
                  )
                  .digest('hex'),
                policy: LOOP_CADENCE_POLICY,
              },
            }
          : {}),
        source: 'EXISTING_FIXED_VP9_LOOP',
        pageTrace:
          'Independent page currentTime and rVFC metadata, bounded per document over localhost; no scanner generation IDs or raw frames.',
      }
    : undefined;
  const numericProbe = pixelProbe || denseFixture;
  if (pixelProbe && denseFixture)
    throw new Error(
      'Choose static geometry probes or the dense workload, not both.',
    );
  const candidateFixture =
    encodedFixture ||
    videoFixture ||
    denseFixture ||
    process.env.EPI_LESS_FIXTURE_CANDIDATE === '1';
  const candidateModePath = path.join(evidence, 'candidate-mode.json');
  const candidateCommandPath = path.join(evidence, 'candidate-command.json');
  if (candidateFixture)
    await writeFile(
      candidateModePath,
      JSON.stringify({
        fixed: loopFixture,
        video: videoFixture,
        dense: denseFixture,
        ...(encodedFixture ? { encoded: true } : {}),
        ...(loopFixture ? { loop: true } : {}),
      }),
    );
  const emulateViewport =
    process.env.EPI_LESS_FIXTURE_EMULATED_VIEWPORT === '1';
  const windowWidth = Number(process.env.EPI_LESS_FIXTURE_WINDOW_WIDTH ?? 900);
  const windowHeight = Number(
    process.env.EPI_LESS_FIXTURE_WINDOW_HEIGHT ?? 650,
  );
  if (
    ![windowWidth, windowHeight].every(
      (value) => Number.isInteger(value) && value >= 400 && value <= 4000,
    )
  )
    throw new Error(
      'Fixture window dimensions must be integer pixels from 400 to 4000.',
    );

  return {
    gentleMotion,
    interactive,
    pixelProbe,
    videoFixture,
    denseFixture,
    encodedFixture,
    encodedRecheck,
    loopFixture,
    loopCadence,
    encodedAssets,
    encodedRecheckFixture,
    encodedRecheckModuleSha256,
    loopDocuments,
    loopHtml,
    loopFixtureIdentity,
    numericProbe,
    candidateFixture,
    candidateModePath,
    candidateCommandPath,
    emulateViewport,
    windowWidth,
    windowHeight,
  };
}
