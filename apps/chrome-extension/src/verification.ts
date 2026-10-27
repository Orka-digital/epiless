import {
  phaseComparisonReasons,
  phasePlanKey,
  validPhasePlan,
} from './animation-phase';
import { normalizePublicUrl, planRoute, type Finding } from '@epi-less/core';
import {
  mediaComparisonReasons,
  mediaPlanKey,
  validMediaPlan,
} from './media-replay';
import {
  TERMINAL_STATES,
  type Observation,
  type ReplayScenario,
  type ScanJob,
} from './model';

export interface IssueAnchor {
  taskId: string;
  observationId: string;
  findingId: string;
}
export interface IssueReview extends IssueAnchor {
  id: string;
  at: string;
  decision: 'CONFIRMED' | 'FALSE_POSITIVE' | 'RESOLVED' | 'REOPENED';
  note: string;
  verificationJobId?: string;
}
export interface VerificationComparison {
  status: 'REOBSERVED' | 'NOT_OBSERVED' | 'INCOMPARABLE';
  reasons: string[];
  baselineJobId: string;
  verificationJobId: string;
  matchingFindingIds: string[];
}

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
  if (
    plan.version !== 1 ||
    !['current', 'compact'].includes(plan.profile) ||
    (plan.viewportMethod !== undefined &&
      !['PHYSICAL', 'CDP'].includes(plan.viewportMethod)) ||
    ![plan.viewport.width, plan.viewport.height].every(
      (v) => Number.isInteger(v) && v > 0 && v <= 16384,
    ) ||
    !Number.isFinite(plan.viewport.dpr) ||
    plan.viewport.dpr <= 0 ||
    plan.viewport.dpr > 16 ||
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
  for (const step of plan.steps) {
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
          (path) =>
            typeof path !== 'string' || !path.length || path.length > 512,
        ) ||
        (step.expectedState !== undefined &&
          (typeof step.expectedState !== 'string' ||
            step.expectedState.length > 1024))
      )
        throw new Error('Ongeldige bedieningsstap.');
    } else throw new Error('Onbekende hercontrolestap.');
  }
  if (plan.mediaPlan !== undefined && !validMediaPlan(plan.mediaPlan))
    throw new Error('De bewaarde mediavoorwaarden zijn ongeldig.');
  if (plan.phasePlan !== undefined && !validPhasePlan(plan.phasePlan))
    throw new Error('De bewaarde document- of animatiefase is ongeldig.');
  if (plan.stateKey !== replayStateKey(plan))
    throw new Error('De identiteit van het bewaarde scenario klopt niet.');
  return structuredClone(plan);
}

export function findIssue(job: ScanJob, anchor: IssueAnchor) {
  const task = job.tasks.find((value) => value.id === anchor.taskId);
  const observation = task?.observations.find(
    (value) => value.id === anchor.observationId,
  );
  const finding = observation?.measurement?.findings.find(
    (value) => value.id === anchor.findingId,
  );
  return { task, observation, finding };
}

function adequate(observation: Observation): boolean {
  const measurement = observation.measurement;
  const quality = measurement?.quality;
  return Boolean(
    observation.achieved &&
    observation.coverage === 'TESTED' &&
    measurement &&
    measurement.status !== 'INCONCLUSIVE' &&
    quality &&
    quality.frameCount >= 2 &&
    quality.effectiveFps >= 50 &&
    quality.maxGapMs <= 100 &&
    !quality.downsampled &&
    !quality.interrupted &&
    quality.captureWindowMs !== undefined &&
    quality.captureWindowMs >=
      (observation.replay?.durationMs ?? Infinity) - 100 &&
    quality.leadingIdleMs !== undefined &&
    quality.leadingIdleMs <= 100 &&
    quality.trailingIdleMs !== undefined &&
    quality.trailingIdleMs <= 100,
  );
}

function sameCandidate(a: Finding, b: Finding): boolean {
  if (a.type !== b.type) return false;
  // A unique sampled structural source tolerates layout movement. It remains a
  // candidate identity, not proof that the sampled element caused the signal.
  if (a.source?.candidates.length === 1 && b.source?.candidates.length === 1)
    return (
      JSON.stringify(a.source.candidates[0].selectorPath) ===
      JSON.stringify(b.source.candidates[0].selectorPath)
    );
  const ar = a.region,
    br = b.region;
  if (!ar || !br) return false;
  const intersection =
    Math.max(
      0,
      Math.min(ar.x + ar.width, br.x + br.width) - Math.max(ar.x, br.x),
    ) *
    Math.max(
      0,
      Math.min(ar.y + ar.height, br.y + br.height) - Math.max(ar.y, br.y),
    );
  const union = ar.width * ar.height + br.width * br.height - intersection;
  return union > 0 && intersection / union >= 0.5;
}

/** Absence is only evidence for a later human decision, never an automatic resolution. */
export function compareVerification(
  baseline: ScanJob,
  anchor: IssueAnchor,
  next: ScanJob,
): VerificationComparison {
  const { observation, finding } = findIssue(baseline, anchor);
  const reasons: string[] = [];
  const target = next.verificationOf;
  if (
    !target ||
    target.jobId !== baseline.id ||
    target.taskId !== anchor.taskId ||
    target.observationId !== anchor.observationId
  )
    reasons.push(
      'Deze meting is geen gerichte hercontrole van het oorspronkelijke scenario.',
    );
  const observations = next.tasks
    .flatMap((task) => task.observations)
    .filter(
      (value) =>
        value.replay && value.replay.stateKey === observation?.replay?.stateKey,
    );
  const repeated = observations.length === 1 ? observations[0] : undefined;
  if (
    !finding ||
    !observation?.replay ||
    baseline.detailsExpiredAt ||
    next.detailsExpiredAt
  )
    reasons.push(
      'De oorspronkelijke meetdetails of het reproduceerbare scenario ontbreken.',
    );
  if (
    !baseline.engineVersion ||
    baseline.engineVersion !== next.engineVersion ||
    !baseline.runnerVersion ||
    baseline.runnerVersion !== next.runnerVersion
  )
    reasons.push(
      'Detector- of runnerversies verschillen; resultaten zijn niet rechtstreeks vergelijkbaar.',
    );
  if (
    !baseline.scannerBuildSha256 ||
    !/^[a-f0-9]{64}$/.test(baseline.scannerBuildSha256) ||
    baseline.scannerBuildSha256 !== next.scannerBuildSha256
  )
    reasons.push(
      'De exacte scannerbuild ontbreekt of verschilt. Een gelijk versienummer alleen bewijst geen vergelijkbare implementatie.',
    );
  if (
    baseline.origin !== next.origin ||
    !repeated ||
    !next.endedAt ||
    !TERMINAL_STATES.includes(next.state)
  )
    reasons.push('Hetzelfde scenario is nog niet aantoonbaar afgerond.');
  if (
    Date.parse(next.startedAt) <=
    Date.parse(baseline.endedAt ?? baseline.updatedAt)
  )
    reasons.push(
      'De hercontrole moet na de oorspronkelijke meting zijn gestart.',
    );
  if (
    !observation ||
    !adequate(observation) ||
    !repeated ||
    !adequate(repeated)
  )
    reasons.push(
      'Beide metingen moeten voldoende volledige capture en bereikte toestanden hebben.',
    );
  if (
    observation?.measurement &&
    repeated?.measurement &&
    (observation.measurement.quality.width !==
      repeated.measurement.quality.width ||
      observation.measurement.quality.height !==
        repeated.measurement.quality.height)
  )
    reasons.push('De resolutie van de meetbeelden verschilt.');
  if (observation && repeated) {
    reasons.push(...mediaComparisonReasons(observation, repeated, finding));
    reasons.push(...phaseComparisonReasons(observation, repeated, finding));
  }
  const matches = finding
    ? (repeated?.measurement?.findings ?? []).filter((value) =>
        sameCandidate(finding, value),
      )
    : [];
  if (
    !matches.length &&
    finding &&
    repeated?.measurement?.findings.some((value) => value.type === finding.type)
  )
    reasons.push(
      'Er zijn andere kandidaten van hetzelfde type; de oorspronkelijke bron is niet eenduidig te volgen.',
    );
  return {
    status: reasons.length
      ? 'INCOMPARABLE'
      : matches.length
        ? 'REOBSERVED'
        : 'NOT_OBSERVED',
    reasons,
    baselineJobId: baseline.id,
    verificationJobId: next.id,
    matchingFindingIds: matches.map((value) => value.id),
  };
}

export function issueReviewKey(anchor: IssueAnchor): string {
  return JSON.stringify([
    anchor.taskId,
    anchor.observationId,
    anchor.findingId,
  ]);
}

export function reviewSummary(jobs: readonly ScanJob[]) {
  let confirmed = 0,
    resolved = 0,
    reopened = 0,
    falsePositives = 0;
  for (const job of jobs) {
    const latest = new Map<string, IssueReview>();
    for (const review of job.reviews ?? [])
      latest.set(issueReviewKey(review), review);
    for (const review of latest.values()) {
      if (review.decision === 'CONFIRMED' || review.decision === 'REOPENED')
        confirmed++;
      if (review.decision === 'RESOLVED') resolved++;
      if (review.decision === 'REOPENED') reopened++;
      if (review.decision === 'FALSE_POSITIVE') falsePositives++;
    }
  }
  return { confirmed, resolved, reopened, falsePositives };
}

/** A past clean scan cannot close a new review cycle, even after reconfirming.
 * Initial confirmation may be retrospective; later resolution/reopening is a
 * freshness boundary, so its earlier evidence cannot be recycled. */
export function hasFreshVerification(
  job: ScanJob,
  anchor: IssueAnchor,
  verification: ScanJob,
): boolean {
  const boundary = (job.reviews ?? [])
    .filter(
      (review) =>
        issueReviewKey(review) === issueReviewKey(anchor) &&
        (review.decision === 'RESOLVED' || review.decision === 'REOPENED'),
    )
    .at(-1);
  return (
    !boundary ||
    (Number.isFinite(Date.parse(verification.startedAt)) &&
      Number.isFinite(Date.parse(boundary.at)) &&
      Date.parse(verification.startedAt) > Date.parse(boundary.at))
  );
}

export function appendReview(
  job: ScanJob,
  input: Omit<IssueReview, 'id' | 'at'>,
  verification?: ScanJob,
): void {
  const { finding } = findIssue(job, input);
  if (!finding || job.detailsExpiredAt || !TERMINAL_STATES.includes(job.state))
    throw new Error('Deze bevinding kan niet beoordeeld worden.');
  if (
    !['CONFIRMED', 'FALSE_POSITIVE', 'RESOLVED', 'REOPENED'].includes(
      input.decision,
    ) ||
    typeof input.note !== 'string' ||
    input.note.trim().length < 3 ||
    input.note.length > 1000
  )
    throw new Error('Kies een beoordeling en licht die toe (3–1000 tekens).');
  const previous = (job.reviews ?? [])
    .filter((review) => issueReviewKey(review) === issueReviewKey(input))
    .at(-1);
  if (input.decision === 'RESOLVED') {
    if (!previous || !['CONFIRMED', 'REOPENED'].includes(previous.decision))
      throw new Error(
        'Bevestig eerst dat deze kandidaat een te herstellen probleem is.',
      );
    if (
      !verification ||
      input.verificationJobId !== verification.id ||
      compareVerification(job, input, verification).status !== 'NOT_OBSERVED'
    )
      throw new Error(
        'Opgelost vereist een vergelijkbare gerichte hercontrole zonder deze kandidaat en jouw beoordeling.',
      );
    if (!hasFreshVerification(job, input, verification))
      throw new Error(
        'Opgelost vereist een nieuwe hercontrole na de laatste opgeloste of heropende beoordeling.',
      );
  }
  if (input.decision === 'REOPENED') {
    if (
      previous?.decision !== 'RESOLVED' ||
      !verification ||
      input.verificationJobId !== verification.id ||
      compareVerification(job, input, verification).status !== 'REOBSERVED' ||
      Date.parse(verification.startedAt) <= Date.parse(previous.at)
    )
      throw new Error(
        'Teruggekeerd vereist een nieuwe vergelijkbare waarneming na de opgeloste beoordeling.',
      );
  }
  if ((job.reviews?.length ?? 0) >= 1000)
    throw new Error('Het maximumaantal lokale beoordelingen is bereikt.');
  (job.reviews ??= []).push({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    taskId: input.taskId,
    observationId: input.observationId,
    findingId: input.findingId,
    decision: input.decision,
    note: input.note.trim(),
    ...(['RESOLVED', 'REOPENED'].includes(input.decision)
      ? { verificationJobId: input.verificationJobId }
      : {}),
  });
}
