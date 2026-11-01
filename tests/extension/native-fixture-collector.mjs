import { nativeFixtureEnvironment } from './native-fixture-environment.mjs';
// Manual toolbar-capture gate. Static by default; optional tiny low-contrast motion.
// The opt-in candidate mode changes one 2 × 2 CSS-pixel signal. DENSE adds
// a separately disclosed low-contrast GPU workload during the control observation.
// Start this script, then use the real browser toolbar to authorise/start FlashGuard.

import { cp, readFile, writeFile } from 'node:fs/promises';

import path from 'node:path';

/** Collect native exports and screenshots; callers retain ownership of the browser and fixture server. */
export function startNativeFixtureCollector({
  context,
  candidateFixture,
  candidateCommandPath,
  completedCommands,
  evidence,
  completed,
  worker,
  encodedRecheckFixture,
  requests,
  emulateViewport,
  windowWidth,
  windowHeight,
  initialGeometry,
  geometry,
  pixelProbe,
  denseFixture,
  loopFixture,
  loopFixtureIdentity,
  loopDocuments,
  extensionBuild,
  encodedRecheckModuleSha256,
  encodedAssets,
  encodedFixture,
  videoFixture,
  interactive,
  gentleMotion,
}) {
  const timer = setInterval(async () => {
    try {
      const dashboard = context
        .pages()
        .find((candidate) => candidate.url().includes('/dashboard.html'));
      if (!dashboard) return;
      if (candidateFixture) {
        const command = await readFile(candidateCommandPath, 'utf8')
          .then(JSON.parse)
          .catch(() => undefined);
        if (
          command &&
          typeof command.id === 'string' &&
          /^[a-z0-9-]{1,80}$/.test(command.id) &&
          !completedCommands.has(command.id)
        ) {
          completedCommands.add(command.id);
          if (
            ![
              'PREPARE_RECHECK',
              'REVIEW_ISSUE',
              'GET_STATE',
              'EXPORT',
            ].includes(command.message?.type)
          )
            throw new Error(
              'Fixture control only supports review, inspection and recheck preparation; capture still needs the real toolbar.',
            );
          const result = await dashboard.evaluate(
            (message) => chrome.runtime.sendMessage(message),
            command.message,
          );
          await writeFile(
            path.join(evidence, `command-${command.id}.json`),
            JSON.stringify(result, null, 2),
          );
          console.log(
            JSON.stringify({
              command: command.id,
              ok: result.ok,
              error: result.error,
            }),
          );
        }
      }
      const response = await dashboard.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'GET_STATE' }),
      );
      for (const job of response.value.jobs) {
        if (completed.has(job.id)) continue;
        console.log(
          JSON.stringify({
            id: job.id,
            state: job.state,
            routes: job.tasks.map((task) => ({
              url: task.url,
              state: task.state,
              observations: task.observations.map((observation) => ({
                scenario: observation.scenario,
                frames: observation.measurement?.quality.frameCount,
                fps: observation.measurement?.quality.effectiveFps,
              })),
            })),
          }),
        );
        if (
          ['COMPLETED', 'PARTIAL', 'INTERRUPTED', 'ERROR'].includes(job.state)
        ) {
          const candidateState = candidateFixture
            ? await worker.evaluate(async (tabId) => {
                const result = await chrome.scripting.executeScript({
                  target: { tabId },
                  world: 'MAIN',
                  func: () => {
                    window.__nativeLoopFlush?.();
                    window.__nativeRecheckFlush?.();
                    return {
                      geometry: {
                        innerWidth,
                        innerHeight,
                        outerWidth,
                        outerHeight,
                        devicePixelRatio,
                        visibility: document.visibilityState,
                      },
                      fixture: window.__nativeCandidateFixture ?? null,
                    };
                  },
                });
                return result[0]?.result;
              }, job.tabId)
            : undefined;
          if (encodedRecheckFixture && candidateState?.fixture)
            encodedRecheckFixture.append(candidateState.fixture);
          const report = await dashboard.evaluate(
            (id) => chrome.runtime.sendMessage({ type: 'EXPORT', id }),
            job.id,
          );
          await writeFile(
            path.join(evidence, `${job.id}.json`),
            JSON.stringify(report.value, null, 2),
          );
          if (candidateFixture)
            await writeFile(
              path.join(evidence, `${job.id}-local-job.json`),
              JSON.stringify(job, null, 2),
            );
          await writeFile(
            path.join(evidence, 'requests.json'),
            JSON.stringify(requests, null, 2),
          );
          await writeFile(
            path.join(evidence, 'environment.json'),
            JSON.stringify(
              await nativeFixtureEnvironment({
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
              }),
              null,
              2,
            ),
          );
          if (candidateFixture)
            await cp(
              path.join(evidence, 'environment.json'),
              path.join(evidence, `${job.id}-environment.json`),
            );
          await dashboard.screenshot({
            path: path.join(evidence, `${job.id}.png`),
            fullPage: true,
          });
          completed.add(job.id);
        }
      }
    } catch (error) {
      console.error(String(error));
    }
  }, 10000);

  return { timer };
}
