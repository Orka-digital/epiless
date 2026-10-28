import { useRef, useState } from 'react';
import type { AuditReport } from '@epi-less/core';
import { api, ApiError } from '../client-api';
import {
  approveUpload,
  assertApproved,
  forgetUpload,
  getUpload,
  retryDelay,
  updateUpload,
  type PublicationResult,
  type UploadJob,
} from '../upload-queue';
import { useUploadQueue } from './use-upload-queue';
import { terminal, type Intent } from './upload-state';

/** Own the upload lease and verification lifecycle; never send without durable approval. */
export function usePublicationUpload(accountId: string, name: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState<{
    jobId: string;
    intent: Intent;
  } | null>(null);
  const [result, setResult] = useState<PublicationResult | null>(null);
  const operation = useRef<string | null>(null);
  const verifying = useRef(false);
  const queue = useUploadQueue(accountId, setError);
  const { changed, checkAccount } = queue;
  async function pending(id: string) {
    const job = await getUpload(id);
    if (!job || terminal(job) || operation.current !== id)
      throw new Error(
        'Deze opdracht is gestopt of in een ander venster verwerkt.',
      );
    await assertApproved(job);
    return job;
  }
  async function finish(id: string, published: PublicationResult) {
    // A completed request may have raced with cancellation. Show its actual
    // server outcome instead of claiming an online report was cancelled.
    const publication: PublicationResult = {
      id: published.id,
      visibility: published.visibility,
      ...(published.shareUrl ? { shareUrl: published.shareUrl } : {}),
      ...(published.state ? { state: published.state } : {}),
    };
    await updateUpload(id, {
      state: 'COMPLETE',
      publication,
      lastError: undefined,
      retryAt: 0,
    });
    setResult(publication);
    if (operation.current === id) {
      setActive(null);
      setBusy(false);
      operation.current = null;
    }
    await changed();
  }
  async function failed(id: string, cause: unknown) {
    const problem = cause as Error;
    const job = await getUpload(id);
    if (job && !terminal(job)) {
      const paused = cause instanceof ApiError && cause.status === 401;
      const cancelled =
        cause instanceof ApiError && cause.code === 'INTENT_CANCELLED';
      await updateUpload(id, {
        state: cancelled ? 'CANCELLED' : paused ? 'PAUSED' : 'RETRY',
        lastError: problem.message,
        retryAt: paused
          ? 0
          : Date.now() +
            retryDelay(
              job.attempts,
              cause instanceof ApiError ? cause.retryAfterMs : 0,
            ),
      });
    }
    setError(problem.message);
    if (operation.current === id) {
      setActive(null);
      setBusy(false);
      operation.current = null;
    }
    await changed();
  }
  async function commit(job: UploadJob, intentId: string) {
    await pending(job.id);
    await checkAccount(job.accountId);
    const published = await api<PublicationResult>('/api/publications', {
      intentId,
      expectedAccountId: job.accountId,
    });
    await finish(job.id, published);
  }
  async function send(id: string) {
    if (operation.current) return;
    operation.current = id;
    setBusy(true);
    setError('');
    try {
      let job = await pending(id);
      if (job.retryAt > Date.now())
        throw new Error('Wacht tot de aangegeven herprobeertijd.');
      await checkAccount(job.accountId);
      job = (await updateUpload(id, {
        state: 'QUEUED',
        attempts: job.attempts + 1,
        lastError: undefined,
      }))!;
      await pending(id);
      const intent = await api<Intent>('/api/publications/intents', {
        report: job.report,
        visibility: job.visibility,
        contentHash: job.contentHash,
        idempotencyKey: job.idempotencyKey,
        expectedAccountId: job.accountId,
      });
      if (intent.contentHash !== job.contentHash)
        throw new Error(
          'De server bevestigde een andere snapshot. De upload is gestopt.',
        );
      if (intent.publication) return await finish(id, intent.publication);
      await pending(id);
      await updateUpload(id, { intentId: intent.id, state: 'VERIFY' });
      if (!intent.challenge) return await commit(job, intent.id);
      setActive({ jobId: id, intent });
      setBusy(false);
      await changed();
    } catch (e) {
      await failed(id, e);
    }
  }
  async function approve(
    snapshot: AuditReport,
    visibility: string,
    onApproved: () => void,
  ) {
    if (operation.current) return;
    setBusy(true);
    setError('');
    try {
      const job = await approveUpload({
        accountId,
        accountName: name,
        report: snapshot,
        visibility,
      });
      onApproved();
      await changed();
      await send(job.id);
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }
  async function verify(token: string) {
    if (!active || verifying.current) return;
    const { jobId, intent } = active;
    if (!intent.challenge) return;
    verifying.current = true;
    setBusy(true);
    try {
      const job = await pending(jobId);
      await checkAccount(job.accountId);
      await api(`/api/publications/intents/${intent.id}/verify`, {
        token,
        challengeId: intent.challenge.id,
        expectedAccountId: job.accountId,
      });
      await commit(job, intent.id);
    } catch (e) {
      await failed(jobId, e);
    } finally {
      verifying.current = false;
    }
  }
  async function cancel(job: UploadJob) {
    if (operation.current === job.id) {
      operation.current = null;
      setActive(null);
      setBusy(false);
    }
    await updateUpload(job.id, {
      state: 'CANCELLED',
      lastError:
        'Deze browser verstuurt deze opdracht niet meer. Een al voltooide publicatie beheer je via Mijn rapporten.',
    });
    await changed();
    if (!job.intentId) return;
    try {
      const response = await api<{
        state?: string;
        publication?: PublicationResult;
      }>(
        `/api/publications/intents/${job.intentId}`,
        { expectedAccountId: job.accountId, contentHash: job.contentHash },
        'DELETE',
      );
      if (response.publication) await finish(job.id, response.publication);
    } catch {
      setError(
        'De opdracht is lokaal gestopt. De server kon dit niet bevestigen; controleer Mijn rapporten zodra je weer bent aangemeld en verbonden.',
      );
    }
  }

  async function forget(id: string) {
    await forgetUpload(id);
    await changed();
  }
  return {
    ...queue,
    busy,
    error,
    active,
    result,
    setResult,
    setError,
    approve,
    send,
    verify,
    cancel,
    forget,
    failed,
  };
}
