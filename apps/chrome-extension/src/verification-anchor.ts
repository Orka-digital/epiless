import { type ScanJob } from './model';

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

/** Locate the exact task, observation and finding referenced by a review anchor. */
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

/** Create a stable review key from the complete finding anchor. */
export function issueReviewKey(anchor: IssueAnchor): string {
  return JSON.stringify([
    anchor.taskId,
    anchor.observationId,
    anchor.findingId,
  ]);
}
