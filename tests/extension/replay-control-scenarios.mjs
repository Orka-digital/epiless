import assert from 'node:assert/strict';

/** Assert replay cancellation, geometry rejection and completed-result handling using the shared fixture. */
export async function testReplayScenarios({
  run,
  baseline,
  trigger,
  worker,
  inventory,
}) {
  const positive = await run(
    baseline('replay-reached', [{ kind: 'wait', durationMs: 100 }, trigger]),
  );
  const observed = positive.tasks
    .flatMap((task) => task.observations)
    .find((value) => value.scenario === 'targeted-recheck');
  assert.ok(observed, JSON.stringify(positive));
  assert.equal(observed.achieved, true);
  assert.equal(observed.coverage, 'TESTED');
  assert.equal(observed.replay.profile, 'current');
  const segment = await worker.evaluate(
    (id) => globalThis.__segments.find((segment) => segment.id === id),
    observed.id,
  );
  assert.ok(
    segment.clicked >= segment.begunAt && segment.clicked <= segment.endedAt,
    'The actual trigger executes inside the measured segment',
  );
  const failure = await run(
    baseline('replay-stale', [
      { ...trigger, target: { ...trigger.target, kind: 'media' } },
    ]),
  );
  const rejected = failure.tasks
    .flatMap((task) => task.observations)
    .find((value) => value.scenario === 'targeted-recheck');
  assert.equal(rejected.achieved, false);
  assert.equal(rejected.coverage, 'UNREACHED');
  assert.equal(rejected.replay, undefined);
  assert.equal(rejected.reason, 'REPLAY_CONTROL_KIND_CHANGED');
  const prerequisite = await run(
    baseline('replay-prerequisite', [
      { ...trigger, target: { ...trigger.target, kind: 'media' } },
      trigger,
    ]),
  );
  assert.ok(
    prerequisite.tasks[0].observations.some(
      (value) =>
        value.scenario === 'targeted-recheck-unreached' &&
        value.coverage === 'UNREACHED',
    ),
  );
  assert.equal(
    prerequisite.tasks[0].observations.some((value) => value.replay),
    false,
  );
  const compact = await run(baseline('replay-compact', [trigger], true));
  const compactTarget = compact.tasks[0].observations.find(
    (value) => value.scenario === 'targeted-recheck',
  );
  if (compactTarget?.achieved) {
    assert.deepEqual(compactTarget.replay.viewport, {
      width: 600,
      height: 400,
      dpr: inventory.viewport.dpr,
    });
  } else {
    assert.ok(
      compact.tasks[0].observations.some(
        (value) =>
          value.coverage === 'UNREACHED' &&
          /^(VIEWPORT_GEOMETRY_NOT_REACHED|VIEWPORT_WORKSPACE_)/.test(
            value.reason,
          ),
      ),
      'Inactive tab geometry must be explicitly unobserved if Chrome does not resize its CSS viewport',
    );
    assert.equal(
      compact.tasks[0].observations.some((value) => value.replay),
      false,
    );
  }
}
