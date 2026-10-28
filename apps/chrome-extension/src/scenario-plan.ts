import type { PageInventory, ReplayScenario, ReplayStep } from './model';
import { replayStateKey } from './verification';

const MAX_CAROUSEL_STEPS = 4;
const MAX_FOCUS_STEPS = 2;
export const DELAYED_OBSERVATION_MS = 7_000;

/** The key identifies the achieved recipe, not the temporal candidate or a DOM cause. */
export function replayScenario(
  route: string,
  viewport: ReplayScenario['viewport'],
  steps: ReplayStep[],
  durationMs: number,
  profile: ReplayScenario['profile'] = 'current',
  measuredStep?: number,
  viewportMethod: ReplayScenario['viewportMethod'] = 'PHYSICAL',
): ReplayScenario {
  const payload = {
    version: 1 as const,
    route,
    viewport: { ...viewport },
    profile,
    viewportMethod,
    steps: structuredClone(steps),
    durationMs,
    ...(measuredStep === undefined ? {} : { measuredStep }),
  };
  return { ...payload, stateKey: replayStateKey(payload) };
}

export interface ExplorationState {
  attempts: Map<string, number>;
  carouselStates: Map<string, Set<string>>;
  focused: Set<string>;
  focusCount: number;
  hovered: Set<string>;
  hoverCount: number;
}
/** Create empty per-route exploration bookkeeping; no browser action is performed. */
export function newExplorationState(): ExplorationState {
  return {
    attempts: new Map(),
    carouselStates: new Map(),
    focused: new Set(),
    focusCount: 0,
    hovered: new Set(),
    hoverCount: 0,
  };
}
/** Build a replayable hover step from a recorded target. */
export function hoveredAction(
  actions: PageInventory['actions'],
  state: ExplorationState,
) {
  if (state.hoverCount >= 2) return;
  return actions.find(
    (action) =>
      action.target &&
      !['media', 'consent-reject'].includes(action.kind) &&
      !state.hovered.has(action.id),
  );
}
/** Test whether a recorded action still requires an attempt. */
export function actionPending(
  action: PageInventory['actions'][number],
  state: ExplorationState,
): boolean {
  const attempts = state.attempts.get(action.id) ?? 0;
  return action.kind === 'carousel'
    ? attempts < MAX_CAROUSEL_STEPS &&
        !state.carouselStates.get(action.id)?.has(action.state ?? '')
    : attempts === 0;
}
/** Record an attempted action so exploration cannot retry it indefinitely. */
export function recordActionAttempt(
  action: PageInventory['actions'][number],
  state: ExplorationState,
): void {
  state.attempts.set(action.id, (state.attempts.get(action.id) ?? 0) + 1);
  if (action.kind === 'carousel') {
    const observed = state.carouselStates.get(action.id) ?? new Set<string>();
    observed.add(action.state ?? '');
    state.carouselStates.set(action.id, observed);
  }
}
/** Build a replayable focus step from a recorded target. */
export function focusedAction(
  actions: PageInventory['actions'],
  state: ExplorationState,
): PageInventory['actions'][number] | undefined {
  if (state.focusCount >= MAX_FOCUS_STEPS) return;
  return actions.find(
    (action) =>
      action.focusable &&
      action.target &&
      !['media', 'consent-reject'].includes(action.kind) &&
      !state.focused.has(action.id),
  );
}

/** Compare the geometry relevant to replay, including device pixel ratio. */
export function sameViewport(
  expected: ReplayScenario['viewport'],
  actual: ReplayScenario['viewport'],
): boolean {
  return (
    expected.width === actual.width &&
    expected.height === actual.height &&
    Math.abs(expected.dpr - actual.dpr) < 0.001
  );
}
