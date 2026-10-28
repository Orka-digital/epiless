import { phasePlanKey, validPhasePlan } from './animation-phase';

import { normalizePublicUrl, planRoute } from '@epi-less/core';

import { mediaPlanKey, validMediaPlan } from './media-replay';

import { TERMINAL_STATES, type ReplayScenario, type ScanJob } from './model';

/** Explicit field order; identity describes the procedure, not a guessed DOM defect. */
export function replayStateKey(plan: Omit<ReplayScenario, 'stateKey'>): string {
  return JSON.stringify([
    plan.version,
    plan.route,
    plan.profile,
    plan.viewport.width,
    plan.viewport.height,
    plan.viewport.dpr,
    plan.durationMs,
    plan.measuredStep ?? null,
    plan.steps.map((step) =>
      step.kind === 'scroll'
        ? ['scroll', step.y]
        : step.kind === 'wait'
          ? ['wait', step.durationMs]
          : [
              step.kind,
              step.target.kind,
              step.target.selectorPath,
              step.expectedState ?? null,
            ],
    ),
    ...(plan.viewportMethod === 'CDP' ? ['CDP'] : []),
    ...(plan.mediaPlan ? [mediaPlanKey(plan.mediaPlan)] : []),
    ...(plan.phasePlan ? [phasePlanKey(plan.phasePlan)] : []),
  ]);
}

/** Validate retained replay prerequisites and return a detached plan; reject incomplete or changed identity. */
export function buildVerificationPlan(
  job: ScanJob,
  taskId: string,
  observationId: string,
): ReplayScenario {
  const task = job.tasks.find((value) => value.id === taskId);
  const observation = task?.observations.find(
    (value) => value.id === observationId,
  );
  const plan = observation?.replay;
  if (
    !TERMINAL_STATES.includes(job.state) ||
    job.detailsExpiredAt ||
    !task ||
    !observation?.achieved ||
    !observation.measurement ||
    !plan
  )
    throw new Error(
      'Deze observatie heeft geen volledig bewaard, bereikt scenario om te herhalen.',
    );
  const decision = planRoute({
    candidate: plan.route,
    baseUrl: job.startUrl,
    origin: job.origin,
    depth: 0,
  });
  if (
    !decision.allowed ||
    decision.url !== plan.route ||
    plan.route !== normalizePublicUrl(task.url)
  )
    throw new Error(
      'De bewaarde hercontroleroute valt buiten de toegestane scope.',
    );
  validateReplayBounds(plan);
  validateReplaySteps(plan);
  if (plan.mediaPlan !== undefined && !validMediaPlan(plan.mediaPlan))
    throw new Error('De bewaarde mediavoorwaarden zijn ongeldig.');
  if (plan.phasePlan !== undefined && !validPhasePlan(plan.phasePlan))
    throw new Error('De bewaarde document- of animatiefase is ongeldig.');
  if (plan.stateKey !== replayStateKey(plan))
    throw new Error('De identiteit van het bewaarde scenario klopt niet.');
  return structuredClone(plan);
}

function validateReplaySteps(plan: ReplayScenario): void {
  for (const step of plan.steps) validateReplayStep(step);
}

function validateReplayBounds(plan: ReplayScenario): void {
  if (
    plan.version !== 1 ||
    !['current', 'compact'].includes(plan.profile) ||
    (plan.viewportMethod !== undefined &&
      !['PHYSICAL', 'CDP'].includes(plan.viewportMethod)) ||
    !validReplayViewport(plan.viewport) ||
    !Number.isFinite(plan.durationMs) ||
    plan.durationMs < 1000 ||
    plan.durationMs > 120_000 ||
    !Array.isArray(plan.steps) ||
    plan.steps.length > 100 ||
    (plan.measuredStep !== undefined &&
      (!Number.isInteger(plan.measuredStep) ||
        plan.measuredStep < 0 ||
        plan.measuredStep !== plan.steps.length - 1))
  )
    throw new Error('Het bewaarde scenario heeft ongeldige meetgrenzen.');
}

function validReplayViewport(viewport: ReplayScenario['viewport']): boolean {
  return !(
    ![viewport.width, viewport.height].every(
      (v) => Number.isInteger(v) && v > 0 && v <= 16384,
    ) ||
    !Number.isFinite(viewport.dpr) ||
    viewport.dpr <= 0 ||
    viewport.dpr > 16
  );
}

function validateReplayStep(step: ReplayScenario['steps'][number]): void {
  if (step.kind === 'scroll') {
    if (!Number.isFinite(step.y) || step.y < 0 || step.y > 1_000_000)
      throw new Error('Ongeldige scrollstap.');
  } else if (step.kind === 'wait') {
    if (
      !Number.isFinite(step.durationMs) ||
      step.durationMs < 0 ||
      step.durationMs > 30_000
    )
      throw new Error('Ongeldige wachtstap.');
  } else if (
    step.kind === 'control' ||
    step.kind === 'focus' ||
    step.kind === 'hover'
  ) {
    if (
      ![
        'accordion',
        'tab',
        'menu',
        'media',
        'carousel',
        'consent-reject',
      ].includes(step.target.kind) ||
      !Array.isArray(step.target.selectorPath) ||
      !step.target.selectorPath.length ||
      step.target.selectorPath.length > 8 ||
      step.target.selectorPath.some(
        (path) => typeof path !== 'string' || !path.length || path.length > 512,
      ) ||
      (step.expectedState !== undefined &&
        (typeof step.expectedState !== 'string' ||
          step.expectedState.length > 1024))
    )
      throw new Error('Ongeldige bedieningsstap.');
  } else throw new Error('Onbekende hercontrolestap.');
}
