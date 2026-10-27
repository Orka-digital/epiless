import type { BackgroundCommand } from './command-protocol';
import { getJob, mutateJob, setPendingRecheck } from './store';
import { appendReview } from './verification';

export async function handleVerificationCommand(
  message: BackgroundCommand,
): Promise<{ handled: boolean; value?: unknown }> {
  if (message.type === 'CANCEL_RECHECK') {
    await setPendingRecheck(undefined);
    return { handled: true, value: {} };
  }
  if (message.type !== 'REVIEW_ISSUE') return { handled: false };
  if (
    typeof message.jobId !== 'string' ||
    !message.review ||
    typeof message.review !== 'object'
  )
    throw new Error('Ongeldige beoordeling.');
  const review = message.review;
  const verification =
    typeof review.verificationJobId === 'string'
      ? await getJob(review.verificationJobId)
      : undefined;
  const job = await mutateJob(message.jobId, (value) =>
    appendReview(value, review, verification),
  );
  if (!job) throw new Error('De oorspronkelijke audit bestaat niet meer.');
  return { handled: true, value: { saved: true } };
}
