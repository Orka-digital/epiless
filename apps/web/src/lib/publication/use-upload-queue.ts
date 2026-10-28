import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../client-api';
import { listUploads, updateUpload, type UploadJob } from '../upload-queue';
import { terminal } from './upload-state';

/** Observe approved local jobs and pause work when the signed-in account changes. */
export function useUploadQueue(
  accountId: string,
  setError: (message: string) => void,
) {
  const [currentAccount, setCurrentAccount] = useState(accountId);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [now, setNow] = useState(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const refresh = useCallback(async () => {
    setJobs(await listUploads());
    setNow(Date.now());
  }, []);
  async function changed() {
    await refresh();
    channel.current?.postMessage('changed');
  }
  async function checkAccount(expected: string) {
    const session = await api<{ user: { id: string } } | null>(
      '/api/auth/get-session',
      undefined,
      'GET',
    );
    const id = session?.user.id || '';
    setCurrentAccount(id);
    if (id !== expected)
      throw new ApiError(
        'Deze opdracht hoort bij een ander of afgemeld account. Meld opnieuw aan met het oorspronkelijke account.',
        401,
        'ACCOUNT_CHANGED',
      );
  }
  useEffect(() => {
    const reload = () => {
      void refresh().catch((e: Error) => setError(e.message));
    };
    reload();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const focus = () => {
      reload();
      api<{ user: { id: string } } | null>(
        '/api/auth/get-session',
        undefined,
        'GET',
      )
        .then(async (session) => {
          const id = session?.user.id || '';
          setCurrentAccount(id);
          for (const job of await listUploads()) {
            if (!terminal(job) && job.accountId !== id)
              await updateUpload(job.id, { state: 'PAUSED' });
          }
          reload();
        })
        .catch(() => {}); // A connectivity failure does not erase approval.
    };
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('flashguard-upload-status');
      channel.current.onmessage = reload;
    }
    window.addEventListener('focus', focus);
    window.addEventListener('online', focus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', focus);
      window.removeEventListener('online', focus);
      channel.current?.close();
    };
  }, [refresh, setError]);

  return { currentAccount, jobs, now, changed, checkAccount };
}
