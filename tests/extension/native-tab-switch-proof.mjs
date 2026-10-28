// Pure evidence checker. Usage: node verify-native-context-guard.mjs evidence.json
// This does not generate evidence or start/attach a browser.
import assert from 'node:assert/strict';

import {
  assertTabSwitchContext,
  TAB_SWITCH_HYPOTHESIS,
} from './native-context-tab-switch.mjs';

/** Assert every recorded step of the explicitly nonproduction tab-switch intervention. */
export function verifyTabSwitchHypothesis(evidence, common, job) {
  if (evidence.environment.tabSwitchProbe) {
    assert.equal(evidence.mode, 'cancel');
    assert.equal(evidence.environment.hypothesis, TAB_SWITCH_HYPOTHESIS);
    assert.equal(evidence.environment.productionAcceptance, false);
    assert.equal(evidence.productionAcceptance, false);
    const probe = evidence.tabSwitchProbe;
    assert.equal(
      probe?.status,
      'COMPLETED',
      'Hypothesis must actually run to completion.',
    );
    assert.equal(probe.hypothesis, TAB_SWITCH_HYPOTHESIS);
    assert.equal(probe.productionAcceptance, false);
    assert.equal(probe.plan.jobId, job.id);
    assert.equal(probe.plan.generation, job.generation);
    assert.deepEqual(probe.plan.before, evidence.cancellation.before);
    assert.ok(
      evidence.events.some(
        (event) =>
          event.kind === 'DEBUGGER_DETACH_REPLY' &&
          event.tabId === job.tabId &&
          event.at === probe.plan.detach.at &&
          event.requestId === probe.plan.detach.requestId,
      ),
    );
    const mutations = probe.steps.filter((step) => step.kind !== 'CONTEXT');
    assert.deepEqual(
      probe.steps.map((step) => step.label ?? step.kind),
      [
        'before-intent',
        'before-create',
        'CREATE_INACTIVE_BLANK',
        'after-create',
        'before-activate-blank',
        'ACTIVATE_BLANK',
        'after-activate-blank',
        'before-activate-source',
        'ACTIVATE_SOURCE',
        'after-activate-source',
        'before-remove-blank',
        'REMOVE_OWNED_BLANK',
        'after-remove-blank',
      ],
    );
    assert.deepEqual(
      mutations.map((step) => step.kind),
      [
        'CREATE_INACTIVE_BLANK',
        'ACTIVATE_BLANK',
        'ACTIVATE_SOURCE',
        'REMOVE_OWNED_BLANK',
      ],
    );
    assert.equal(mutations[0].result.id, probe.blankId);
    assert.deepEqual(
      mutations.slice(1).map((step) => step.targetTabId),
      [probe.blankId, job.tabId, probe.blankId],
    );
    const labels = [
      'before-intent',
      'before-create',
      'after-create',
      'before-activate-blank',
      'after-activate-blank',
      'before-activate-source',
      'after-activate-source',
      'before-remove-blank',
      'after-remove-blank',
    ];
    const contexts = probe.steps.filter((step) => step.kind === 'CONTEXT');
    assert.deepEqual(
      contexts.map((step) => step.label),
      labels,
    );
    let previousAt = probe.plan.detach.at;
    for (const step of probe.steps) {
      assert.ok(step.at >= previousAt);
      previousAt = step.repliedAt ?? step.at;
      if (step.kind !== 'CONTEXT') {
        assert.ok(step.repliedAt >= step.at);
        continue;
      }
      const hasBlank = ![
        'before-intent',
        'before-create',
        'after-remove-blank',
      ].includes(step.label);
      const blankActive = [
        'after-activate-blank',
        'before-activate-source',
      ].includes(step.label);
      assertTabSwitchContext(
        step.state,
        probe.plan,
        blankActive ? 'BLANK_ACTIVE' : 'SOURCE_ACTIVE',
        hasBlank ? probe.blankId : undefined,
        step.at,
      );
    }
    common.hypothesis = TAB_SWITCH_HYPOTHESIS;
    common.productionAcceptance = false;
  }
}
