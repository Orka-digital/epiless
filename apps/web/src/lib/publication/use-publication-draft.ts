import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AuditReport } from '@epi-less/core';
import {
  buildPublicSnapshot,
  defaultRedaction,
  type RedactionOptions,
} from '../publication-preview';
import type { PublicationResult } from '../upload-queue';
interface ChromeBridge {
  runtime?: {
    sendMessage: (
      id: string,
      message: unknown,
      callback: (response: {
        ok?: boolean;
        report?: unknown;
        error?: string;
      }) => void,
    ) => void;
    lastError?: { message?: string };
  };
}

/** Own the local import and preview; every selection change invalidates approval. */
export function usePublicationDraft(
  signedIn: boolean,
  setError: (message: string) => void,
  setResult: (result: PublicationResult | null) => void,
) {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [redaction, setRedaction] = useState<RedactionOptions | null>(null);
  const [visibility, setVisibility] = useState('PRIVATE');
  const [confirmed, setConfirmed] = useState(false);
  const imported = useRef(false);
  async function importFile(file: File) {
    setError('');
    if (file.size > 1048576) {
      setError('Een rapport mag maximaal 1 MiB groot zijn.');
      return;
    }
    try {
      await accept(JSON.parse(await file.text()));
    } catch (error) {
      setError((error as Error).message);
    }
  }
  const accept = useCallback(
    async (value: unknown) => {
      // The schema parser is loaded only when a report is selected, keeping the
      // initial account/publish island below its JavaScript budget.
      const { auditReportSchema } = await import('@epi-less/core');
      const parsed = auditReportSchema.safeParse(value);
      if (!parsed.success)
        throw new Error('Dit bestand is geen ondersteund epi-less-rapport.');
      setReport(parsed.data);
      setRedaction(defaultRedaction(parsed.data));
      setConfirmed(false);
      setResult(null);
    },
    [setResult],
  );
  useEffect(() => {
    if (imported.current) return;
    imported.current = true;
    const fragment = new URLSearchParams(location.hash.slice(1));
    const extension = fragment.get('extension'),
      nonce = fragment.get('nonce');
    if (!extension || !nonce) return;
    history.replaceState(null, '', location.pathname);
    const bridge = (window as Window & { chrome?: ChromeBridge }).chrome;
    if (!bridge?.runtime || !signedIn) {
      // Synchronize a one-time external extension handoff failure with the UI.
      setError(
        !signedIn
          ? 'Meld je eerst aan. Open dit rapport daarna opnieuw vanuit de extensie; er zijn nog geen gegevens verstuurd.'
          : 'De verbinding met de extensie is niet beschikbaar. Je kunt hieronder een JSON-export kiezen.',
      );
      return;
    }
    bridge.runtime.sendMessage(
      extension,
      { type: 'FLASHGUARD_IMPORT', nonce },
      (response) => {
        if (bridge.runtime?.lastError || !response?.ok) {
          setError(
            'Dit overdrachtsverzoek is verlopen of niet toegestaan. Open de preview opnieuw vanuit de extensie.',
          );
          return;
        }
        accept(response.report).catch((e: Error) => setError(e.message));
      },
    );
  }, [signedIn, accept, setError]);

  const preview = useMemo(() => {
    if (!report || !redaction) return { snapshot: null, error: '' };
    try {
      return { snapshot: buildPublicSnapshot(report, redaction), error: '' };
    } catch (e) {
      return { snapshot: null, error: (e as Error).message };
    }
  }, [report, redaction]);
  function edit(update: RedactionOptions) {
    setRedaction(update);
    setConfirmed(false);
  }
  function clear() {
    setReport(null);
    setRedaction(null);
    setConfirmed(false);
  }
  function changeVisibility(value: string) {
    setVisibility(value);
    setConfirmed(false);
  }
  return {
    report,
    redaction,
    visibility,
    confirmed,
    preview,
    edit,
    importFile,
    clear,
    changeVisibility,
    setConfirmed,
  };
}
