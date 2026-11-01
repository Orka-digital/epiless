import assert from 'node:assert/strict';

import { replayScenario } from '../../apps/chrome-extension/src/scenario-plan.ts';

import { RUNNER_VERSION } from '../../apps/chrome-extension/src/model.ts';

import { ENGINE_VERSION } from '../../packages/analysis-engine/src/index.ts';

/** Create isolated replay jobs and expose storage and execution helpers for the shared browser context. */
export async function createReplayFixtureRunner({
  origin,
  inventory,
  tab,
  control,
  context,
  send,
  worker,
}) {
  const baseline = (name, steps, compact = false) => {
    const recipe = replayScenario(
      `${origin}/`,
      compact
        ? { width: 600, height: 400, dpr: inventory.viewport.dpr }
        : inventory.viewport,
      steps,
      1000,
      compact ? 'compact' : 'current',
      steps.length - 1,
    );
    return {
      id: name,
      engineVersion: ENGINE_VERSION,
      runnerVersion: RUNNER_VERSION,
      tabId: tab.id,
      origin,
      startUrl: recipe.route,
      startedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:02Z',
      endedAt: '2026-01-01T00:00:02Z',
      state: 'PARTIAL',
      stopIntent: false,
      generation: name,
      elapsedMs: 1000,
      skippedLinks: 0,
      mode: 'AUTONOMOUS',
      limitations: [],
      limits: {
        maxRoutes: 1,
        maxDepth: 0,
        maxDurationMs: 20000,
        maxActionsPerRoute: 12,
      },
      tasks: [
        {
          id: 'route',
          url: recipe.route,
          depth: 0,
          state: 'PARTIAL',
          reasons: [],
          observations: [
            {
              id: 'observation',
              scenario: 'accordion',
              startedAt: '2026-01-01T00:00:00Z',
              endedAt: '2026-01-01T00:00:02Z',
              achieved: true,
              coverage: 'TESTED',
              replay: recipe,
              measurement: {
                status: 'INCONCLUSIVE',
                passed: null,
                findings: [],
                limitations: ['FAKE_BASELINE'],
                quality: {
                  frameCount: 2,
                  effectiveFps: 1,
                  maxGapMs: 1000,
                  width: 1,
                  height: 1,
                  downsampled: true,
                  interrupted: false,
                },
              },
            },
          ],
        },
      ],
    };
  };
  const store = (job) =>
    control.evaluate(
      (job) =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open('flashguard-audit-v1');
          open.onsuccess = () => {
            const tx = open.result.transaction('jobs', 'readwrite');
            tx.objectStore('jobs').put(job);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          };
        }),
      job,
    );
  const run = async (job) => {
    await store(job);
    const replayPageCreated = context.waitForEvent('page');
    const prepared = await send({
      type: 'PREPARE_RECHECK',
      replayOf: {
        jobId: job.id,
        taskId: 'route',
        observationId: 'observation',
      },
    });
    assert.equal(prepared.ok, true, prepared.error);
    const replayPage = await replayPageCreated;
    const pending = (await send({ type: 'GET_STATE' })).value.recheck;
    assert.equal(pending.replayOf.jobId, job.id);
    for (let count = 0; count < 100; count++) {
      const loaded = await worker.evaluate(
        (tabId) => chrome.tabs.get(tabId),
        pending.tabId,
      );
      if (loaded.url?.startsWith(job.origin) && loaded.status === 'complete')
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const geometry = await worker.evaluate(
      async (tabId) =>
        chrome.windows.get((await chrome.tabs.get(tabId)).windowId),
      pending.tabId,
    );
    const started = await send({
      type: 'PREPARE_START',
      tabId: pending.tabId,
      replayOf: pending.replayOf,
      mode: 'AUTONOMOUS',
    });
    assert.equal(started.ok, true, started.error);
    if (new URL(job.startUrl).pathname === '/media') {
      // This fixture replaces tabCapture, so Chrome has no capture session to
      // keep the replay renderer producing video frames. START opens the
      // dashboard, so foreground the replay AFTER that command completes.
      // This matches the baseline below. This is
      // control-flow evidence, not background capture/cadence acceptance.
      await replayPage.bringToFront();
      assert.equal(
        await replayPage.evaluate(() => document.visibilityState),
        'visible',
      );
    }
    let result;
    for (let count = 0; count < 100; count++) {
      const state = (await send({ type: 'GET_STATE' })).value;
      result = state.jobs.find(
        (value) => value.verificationOf?.jobId === job.id,
      );
      if (result?.endedAt) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(result?.endedAt, 'Targeted replay must reach a terminal state');
    const restored = await worker.evaluate(
      (windowId) => chrome.windows.get(windowId),
      geometry.id,
    );
    assert.equal(restored.width, geometry.width);
    assert.equal(restored.height, geometry.height);
    return result;
  };

  return { baseline, store, run };
}
