import type { ChallengeData } from '../client-api';
import type { PublicationResult, UploadJob } from '../upload-queue';

/** A server intent binds verification to one already approved snapshot. */
export interface Intent {
  id: string;
  contentHash: string;
  state: string;
  challenge: ChallengeData | null;
  publication?: PublicationResult;
}
/** Completed and cancelled jobs require a fresh explicit approval to send again. */
export const terminal = (job: UploadJob) =>
  job.state === 'COMPLETE' || job.state === 'CANCELLED';
