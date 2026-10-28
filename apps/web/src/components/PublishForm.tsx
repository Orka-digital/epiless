import { useHydrated } from '../lib/use-hydrated';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AuditReport } from '@epi-less/core';
import { api, ApiError, type ChallengeData } from '../lib/client-api';
import {
  buildPublicSnapshot,
  defaultRedaction,
  type RedactionOptions,
} from '../lib/publication-preview';
import {
  approveUpload,
  assertApproved,
  forgetUpload,
  getUpload,
  listUploads,
  retryDelay,
  updateUpload,
  type PublicationResult,
  type UploadJob,
} from '../lib/upload-queue';
import Challenge from './Challenge';

interface Intent {
  id: string;
  contentHash: string;
  state: string;
  challenge: ChallengeData | null;
  publication?: PublicationResult;
}
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
const stateLabel: Record<UploadJob['state'], string> = {
  QUEUED: 'Bewaard; klaar om te versturen',
  VERIFY: 'Nieuwe verificatie nodig',
  RETRY: 'Wacht op opnieuw proberen',
  PAUSED: 'Gepauzeerd; meld aan met het oorspronkelijke account',
  COMPLETE: 'Verwerkt',
  CANCELLED: 'Lokaal geannuleerd',
};
const terminal = (job: UploadJob) =>
  job.state === 'COMPLETE' || job.state === 'CANCELLED';

export default function PublishForm({
  signedIn,
  accountId,
  name,
}: {
  signedIn: boolean;
  accountId: string;
  name: string;
}) {
  const hydrated = useHydrated();
  const [currentAccount, setCurrentAccount] = useState(accountId);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [redaction, setRedaction] = useState<RedactionOptions | null>(null);
  const [visibility, setVisibility] = useState('PRIVATE');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [now, setNow] = useState(0);
  const [active, setActive] = useState<{
    jobId: string;
    intent: Intent;
  } | null>(null);
  const [result, setResult] = useState<PublicationResult | null>(null);
  const imported = useRef(false);
  const operation = useRef<string | null>(null);
  const verifying = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);

  async function refresh() {
    setJobs(await listUploads());
    setNow(Date.now());
  }
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
  }, []);

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
  async function accept(value: unknown) {
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
  }
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
  }, [signedIn]);

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
  async function publish(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!preview.snapshot || !confirmed || operation.current) return;
    setBusy(true);
    setError('');
    try {
      const job = await approveUpload({
        accountId,
        accountName: name,
        report: preview.snapshot,
        visibility,
      });
      setReport(null);
      setRedaction(null);
      setConfirmed(false);
      await changed();
      await send(job.id);
    } catch (e) {
      setError((e as Error).message);
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

  return (
    <div>
      {result && (
        <div className="notice success" role="status">
          <h2>
            {result.state && result.state !== 'ACTIVE'
              ? 'Deze opdracht was al verwerkt.'
              : 'Je rapport staat online.'}
          </h2>
          <p>
            {result.state && result.state !== 'ACTIVE'
              ? 'Het rapport is inmiddels ingetrokken of afgeschermd. Opnieuw proberen maakt het niet opnieuw zichtbaar.'
              : result.visibility === 'PRIVATE'
                ? 'Alleen jouw account heeft toegang.'
                : result.visibility === 'PUBLIC'
                  ? 'Het rapport is opgenomen in de openbare index.'
                  : 'Iedereen met de deellink kan dit rapport bekijken.'}
          </p>
          <div className="actions">
            <a
              className="button"
              href={result.shareUrl || `/reports/${result.id}`}
            >
              Open het rapport <span aria-hidden="true">↗</span>
            </a>
            <a href="/account">Mijn rapporten beheren</a>
          </div>
        </div>
      )}
      {(!signedIn || !currentAccount || currentAccount !== accountId) && (
        <div className="notice">
          Meld je aan om een nieuwe snapshot goed te keuren of ververs deze
          pagina na het wisselen van account. Bewaarde opdrachten blijven aan
          hun oorspronkelijke account gekoppeld.{' '}
          <a href="/account?returnTo=/publish">Naar aanmelden</a>
        </div>
      )}
      <label className="field">
        Kies een lokale JSON-export
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy || Boolean(active) || !signedIn || !hydrated}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file);
          }}
        />
        <small>
          De preview blijft in je browser. Pas na je bevestiging wordt de exacte
          geselecteerde snapshot in de lokale wachtrij bewaard en verstuurd.
        </small>
      </label>
      {report && redaction && (
        <form onSubmit={(event) => void publish(event)}>
          <div className="report-section">
            <p className="eyebrow">Controleer voor je deelt</p>
            <h2>{new URL(report.origin).hostname}</h2>
            <p className="fine">
              {report.routes.length} routes · engine {report.engineVersion} ·{' '}
              {report.startedAt.slice(0, 10)}. Geplaatst onder{' '}
              <strong>{name}</strong>.
            </p>
          </div>
          <fieldset disabled={busy || Boolean(active)}>
            <legend>Routes en gedeelde paden</legend>
            <p className="fine">
              Routepaden zijn standaard vervangen door neutrale labels. Je kunt
              ieder pad aanpassen of bewust het oorspronkelijke pad opnemen.
            </p>
            {report.routes.map((route, i) => (
              <div className="route-item" key={`${route.url}-${i}`}>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={redaction.routes[i].included}
                    onChange={(e) =>
                      edit({
                        ...redaction,
                        routes: redaction.routes.map((r, n) =>
                          n === i ? { ...r, included: e.target.checked } : r,
                        ),
                      })
                    }
                  />
                  <span>
                    Route {i + 1} opnemen · {route.scenarios.length} scenario’s
                  </span>
                </label>
                <p className="fine">
                  Lokaal pad: {new URL(route.url).pathname}
                </p>
                <label className="field">
                  Gedeeld pad voor route {i + 1}
                  <input
                    value={redaction.routes[i].path}
                    disabled={!redaction.routes[i].included}
                    maxLength={4000}
                    onChange={(e) =>
                      edit({
                        ...redaction,
                        routes: redaction.routes.map((r, n) =>
                          n === i ? { ...r, path: e.target.value } : r,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="button ghost"
                  disabled={!redaction.routes[i].included}
                  onClick={() =>
                    edit({
                      ...redaction,
                      routes: redaction.routes.map((r, n) =>
                        n === i
                          ? { ...r, path: new URL(route.url).pathname }
                          : r,
                      ),
                    })
                  }
                >
                  Oorspronkelijk pad van route {i + 1} gebruiken
                </button>
              </div>
            ))}
          </fieldset>
          <fieldset disabled={busy || Boolean(active)}>
            <legend>Optionele oorspronkelijke tekst en diagnose</legend>
            {(
              [
                ['findingText', 'Bevindingsteksten opnemen'],
                ['scanNotes', 'Scanredenen en beperkingen opnemen'],
                ['scenarioLabels', 'Scenariolabels opnemen'],
                [
                  'diagnostics',
                  'Technische diagnose opnemen (pixelsamples en elementaanwijzingen)',
                ],
              ] as const
            ).map(([field, label]) => (
              <label className="check-label" key={field}>
                <input
                  type="checkbox"
                  checked={redaction[field]}
                  onChange={(e) =>
                    edit({ ...redaction, [field]: e.target.checked })
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <details className="route-item">
            <summary>Exacte geselecteerde inhoud bekijken</summary>
            <p className="fine">
              Alleen deze velden worden gedeeld, samen met de gekozen
              zichtbaarheid en jouw accountnaam. Lokale identifiers worden
              vervangen. Origin, meetdatums, versies, meetgegevens en scanstatus
              blijven zichtbaar.
            </p>
            <pre
              role="region"
              tabIndex={0}
              aria-label="Geselecteerde snapshot in JSON"
            >
              <code>
                {preview.snapshot
                  ? JSON.stringify(preview.snapshot, null, 2)
                  : preview.error}
              </code>
            </pre>
          </details>
          {preview.error && (
            <p className="notice error" role="alert">
              {preview.error}
            </p>
          )}
          <label className="field">
            Wie mag het rapport zien?
            <select
              value={visibility}
              disabled={busy || Boolean(active)}
              onChange={(e) => {
                setVisibility(e.target.value);
                setConfirmed(false);
              }}
            >
              <option value="PRIVATE">Privé — alleen mijn account</option>
              <option value="UNLISTED">
                Via een link — iedereen met de link
              </option>
              <option value="PUBLIC">Openbaar — vindbaar in de index</option>
            </select>
          </label>
          <p className="notice">
            Controleer ook aangepaste paden en optionele teksten op gevoelige
            gegevens. Ruwe frames, screenshots, cookies en lokale identifiers
            worden niet opgenomen. Een gedeelde kopie kan worden doorgestuurd.
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              required
              checked={confirmed}
              disabled={busy || Boolean(active)}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              Ik heb de geselecteerde inhoud en zichtbaarheid gecontroleerd en
              wil deze snapshot online bewaren.
            </span>
          </label>
          <div className="actions">
            <button
              className="button"
              type="submit"
              disabled={
                busy ||
                Boolean(active) ||
                !signedIn ||
                !accountId ||
                currentAccount !== accountId ||
                !confirmed ||
                !preview.snapshot?.routes.length
              }
            >
              {busy ? 'Bezig met bewaren…' : 'Rapport online bewaren'}{' '}
              <span aria-hidden="true">↗</span>
            </button>
          </div>
        </form>
      )}
      {jobs.length > 0 && (
        <section
          className="report-section"
          aria-labelledby="upload-queue-title"
        >
          <h2 id="upload-queue-title">Lokale uploadwachtrij</h2>
          <p className="fine">
            Alleen goedgekeurde snapshots. Na herladen, uitloggen of
            netwerkuitval kies je zelf Opnieuw proberen; er is geen automatische
            publicatielus. Verificatietokens worden nooit bewaard. Deze browser
            bewaart maximaal 25 opdrachten; verwijderen van browsergegevens wist
            deze wachtrij.
          </p>
          {jobs.map((job) => (
            <article
              className="route-item"
              key={job.id}
              data-upload-id={job.id}
            >
              <h3>{new URL(job.report.origin).hostname}</h3>
              <p className="fine">
                {job.accountName} · {job.visibility} · {stateLabel[job.state]}
                {job.accountId !== currentAccount && ' · ander account'}
              </p>
              {job.lastError && <p>{job.lastError}</p>}
              {!terminal(job) && job.retryAt > now && (
                <p role="status">
                  Opnieuw proberen over {Math.ceil((job.retryAt - now) / 1000)}{' '}
                  seconden.
                </p>
              )}
              {job.accountId === currentAccount && (
                <details>
                  <summary>Bewaarde goedgekeurde snapshot</summary>
                  <p className="fine">
                    Inhoudshash: <code>{job.contentHash}</code>
                  </p>
                  <pre
                    role="region"
                    tabIndex={0}
                    aria-label="Goedgekeurde snapshot in JSON"
                  >
                    <code>{JSON.stringify(job.report, null, 2)}</code>
                  </pre>
                </details>
              )}
              <div className="actions">
                {!terminal(job) ? (
                  <>
                    <button
                      type="button"
                      className="button"
                      disabled={
                        busy ||
                        Boolean(active) ||
                        job.accountId !== currentAccount ||
                        job.retryAt > now
                      }
                      onClick={() => void send(job.id)}
                    >
                      Opnieuw proberen
                    </button>
                    <button
                      type="button"
                      className="button ghost"
                      onClick={() =>
                        void cancel(job).catch((e: Error) =>
                          setError(e.message),
                        )
                      }
                    >
                      Opdracht annuleren
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() =>
                      void forgetUpload(job.id)
                        .then(changed)
                        .catch((e: Error) => setError(e.message))
                    }
                  >
                    Uit lokale wachtrij verwijderen
                  </button>
                )}
                {job.publication && (
                  <a href="/account">Online rapport beheren</a>
                )}
              </div>
              {active?.jobId === job.id && active.intent.challenge && (
                <Challenge
                  challenge={active.intent.challenge}
                  onToken={(token) => void verify(token)}
                  onError={(message) => void failed(job.id, new Error(message))}
                />
              )}
            </article>
          ))}
        </section>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
