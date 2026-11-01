import { normalizePublicUrl, planRoute } from '@epi-less/core';
import type { PageInventory, RouteTask, ScanJob } from './model';

/** Identify hash navigation that cannot be represented by the canonical route queue. */
export function hasHashRoute(url: string, base?: string): boolean {
  try {
    return /^#!?\//.test(new URL(url, base).hash);
  } catch {
    return false;
  }
}

/** Raw fragments are compared transiently; callers persist only normalized URLs. */
export function observationRouteChanged(
  before: string,
  actual: string,
): boolean {
  try {
    const previous = new URL(before);
    const current = new URL(actual);
    return (
      normalizePublicUrl(before) !== normalizePublicUrl(actual) ||
      Boolean(current.search || current.username || current.password) ||
      ((hasHashRoute(before) || hasHashRoute(actual)) &&
        previous.hash !== current.hash)
    );
  } catch {
    return true;
  }
}

/** Re-evaluate after each inventory: lazy loading can grow beyond the initial height. */
export function nextScrollPosition(
  page: Pick<PageInventory, 'scrollHeight' | 'viewport'>,
  coveredBottom: number,
  steps: number,
): number | undefined {
  if (
    steps >= 6 ||
    page.scrollHeight <= coveredBottom + 4 ||
    coveredBottom >= 50_000 + page.viewport.height
  )
    return undefined;
  return Math.max(
    0,
    Math.min(
      coveredBottom - page.viewport.height * 0.25,
      page.scrollHeight - page.viewport.height,
      50_000,
    ),
  );
}

/** Record the reached same-origin URL and remove a queued alias of this route. */
export function registerReachedRoute(
  job: ScanJob,
  taskId: string,
  actual: string,
): string {
  const task = job.tasks.find((candidate) => candidate.id === taskId);
  if (!task || hasHashRoute(actual))
    throw new Error('HASH_ROUTER_ROUTE_UNOBSERVED');
  const decision = planRoute({
    candidate: actual,
    baseUrl: task.url,
    origin: job.origin,
    depth: task.depth,
    maxDepth: job.limits.maxDepth,
  });
  if (!decision.allowed || !decision.url)
    throw new Error(`REACHED_ROUTE_BLOCKED: ${decision.reason}`);
  if (task.url !== decision.url) {
    task.reasons.push(
      `Same-origin redirect: ${task.url} → ${decision.url}. Subsequent viewport observations belong to the reached URL.`,
    );
    task.aliases = [
      ...new Set([...(task.aliases ?? []), normalizePublicUrl(task.url)]),
    ];
    task.url = decision.url;
    for (const queued of job.tasks.filter(
      (candidate) =>
        candidate.id !== taskId &&
        candidate.url === task.url &&
        candidate.state === 'QUEUED',
    ))
      task.aliases = [...new Set([...task.aliases, ...(queued.aliases ?? [])])];
    job.tasks = job.tasks.filter(
      (candidate) =>
        candidate.id === taskId ||
        candidate.url !== task.url ||
        candidate.state !== 'QUEUED',
    );
  }
  return task.url;
}

/** Keep one measured route when a new redirect alias resolves to it later. */
export function mergePreviouslyMeasuredRoute(
  job: ScanJob,
  taskId: string,
): boolean {
  const current = job.tasks.find((task) => task.id === taskId);
  if (!current) return false;
  const previous = job.tasks.find(
    (task) =>
      task.id !== taskId &&
      task.url === current.url &&
      ['OBSERVED', 'PARTIAL'].includes(task.state) &&
      task.observations.some((observation) =>
        ['initial-viewport', 'extended-viewport'].includes(
          observation.scenario,
        ),
      ),
  );
  if (!previous) return false;
  previous.aliases = [
    ...new Set([...(previous.aliases ?? []), ...(current.aliases ?? [])]),
  ];
  previous.reasons.push(
    ...current.reasons,
    'A redirect alias reached this previously measured route; its transition is retained without repeating the viewport scan.',
  );
  previous.observations.push(...current.observations);
  if (
    current.observations.some(
      (observation) =>
        !observation.achieved ||
        !observation.measurement ||
        observation.measurement.quality.frameCount < 2 ||
        observation.measurement.quality.effectiveFps < 50 ||
        observation.measurement.quality.maxGapMs > 100 ||
        observation.measurement.quality.interrupted,
    )
  )
    previous.state = 'PARTIAL';
  job.tasks = job.tasks.filter((task) => task.id !== taskId);
  return true;
}

/** Select the next eligible task without mutating its execution state. */
export function nextTask(job: ScanJob): RouteTask | undefined {
  if (
    job.stopIntent ||
    job.state !== 'RUNNING' ||
    job.elapsedMs >= job.limits.maxDurationMs
  )
    return undefined;
  return job.tasks.find((task) => task.state === 'QUEUED');
}
/** Add only policy-allowed unseen routes within the job bounds. */
export function enqueueRoutes(
  job: ScanJob,
  links: readonly string[],
  parent: RouteTask,
  rendered = false,
  scrollY = 0,
): void {
  const sourceScrollY = Number.isFinite(scrollY)
    ? Math.max(0, Math.min(50_000, Math.round(scrollY)))
    : 0;
  const source = rendered
    ? planRoute({
        candidate: parent.url,
        baseUrl: job.startUrl,
        origin: job.origin,
        depth: parent.depth,
        maxDepth: job.limits.maxDepth,
      })
    : undefined;
  for (const candidate of links) {
    if (hasHashRoute(candidate, parent.url)) {
      job.skippedLinks++;
      if (!job.limitations.includes('HASH_ROUTER_ROUTES_UNOBSERVED'))
        job.limitations.push('HASH_ROUTER_ROUTES_UNOBSERVED');
      continue;
    }
    const decision = planRoute({
      candidate,
      baseUrl: parent.url,
      origin: job.origin,
      depth: parent.depth + 1,
      maxDepth: job.limits.maxDepth,
    });
    if (!decision.allowed || !decision.url) {
      if (decision.reason !== 'ALREADY_VISITED') job.skippedLinks++;
      continue;
    }
    const existing = job.tasks.find(
      (task) =>
        task.url === decision.url || task.aliases?.includes(decision.url!),
    );
    if (existing) {
      preserveNavigationSource(existing, source, sourceScrollY);
      continue;
    }
    if (job.tasks.length >= job.limits.maxRoutes) {
      if (!job.limitations.includes('ROUTE_LIMIT_REACHED'))
        job.limitations.push('ROUTE_LIMIT_REACHED');
      break;
    }
    job.tasks.push({
      id: crypto.randomUUID(),
      url: decision.url,
      navigationSource: source?.allowed ? source.url : undefined,
      navigationScrollY: source?.allowed ? sourceScrollY : undefined,
      depth: parent.depth + 1,
      state: 'QUEUED',
      observations: [],
      reasons: [],
    });
  }
}
/** Reject stale execution generations before they can mutate scan state. */
export function assertLease(
  job: ScanJob | undefined,
  generation: string,
): asserts job is ScanJob {
  if (
    !job ||
    job.generation !== generation ||
    job.stopIntent ||
    job.state !== 'RUNNING'
  )
    throw new Error('RUNNER_CANCELLED');
}
/** Derive completion from recorded coverage and stop conditions, never from absence of findings alone. */
export function computeCompletion(job: ScanJob): 'COMPLETED' | 'PARTIAL' {
  return job.tasks.some((task) => task.state !== 'OBSERVED') ||
    job.limitations.some((reason) =>
      /LIMIT|UNOBSERVED|INTERRUPT|BLOCKED/.test(reason),
    )
    ? 'PARTIAL'
    : 'COMPLETED';
}
/** Accept transfers only from the configured web origin and trusted extension context. */
export function trustedTransferSender(
  sender: { url?: string; tab?: { id?: number } },
  origin: string,
): sender is { url: string; tab: { id: number } } {
  try {
    const url = new URL(sender.url ?? '');
    return (
      url.origin === origin &&
      (url.pathname === '/publish' || url.pathname === '/publish/') &&
      typeof sender.tab?.id === 'number'
    );
  } catch {
    return false;
  }
}

function preserveNavigationSource(
  existing: RouteTask,
  source: ReturnType<typeof planRoute> | undefined,
  sourceScrollY: number,
): void {
  if (
    existing.state === 'QUEUED' &&
    !existing.navigationSource &&
    source?.allowed
  ) {
    existing.navigationSource = source.url;
    existing.navigationScrollY = sourceScrollY;
  }
}
