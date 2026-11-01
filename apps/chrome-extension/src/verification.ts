import { TERMINAL_STATES, type ScanJob } from './model';
import {
  findIssue,
  issueReviewKey,
  type IssueAnchor,
  type IssueReview,
} from './verification-anchor';
import { compareVerification } from './verification-comparison';

/** Aggregate explicit reviewer decisions and subsequent verification outcomes. */
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

/** Append a validated review decision; resolution requires a fresh comparable verification. */
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
  assertReviewTransition(job, input, previous, verification);
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
export { findIssue, issueReviewKey } from './verification-anchor';
export type {
  IssueAnchor,
  IssueReview,
  VerificationComparison,
} from './verification-anchor';
export { compareVerification } from './verification-comparison';
export { buildVerificationPlan, replayStateKey } from './verification-plan';

function assertReviewTransition(
  job: ScanJob,
  input: Omit<IssueReview, 'id' | 'at'>,
  previous: IssueReview | undefined,
  verification: ScanJob | undefined,
): void {
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
}
