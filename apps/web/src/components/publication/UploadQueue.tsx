import type { UploadJob } from '../../lib/upload-queue';
import { terminal, type Intent } from '../../lib/publication/upload-state';
import Challenge from '../Challenge';
const stateLabel: Record<UploadJob['state'], string> = {
  QUEUED: 'Bewaard; klaar om te versturen',
  VERIFY: 'Nieuwe verificatie nodig',
  RETRY: 'Wacht op opnieuw proberen',
  PAUSED: 'Gepauzeerd; meld aan met het oorspronkelijke account',
  COMPLETE: 'Verwerkt',
  CANCELLED: 'Lokaal geannuleerd',
};

/** Display durable approved jobs; retry and cancellation stay explicit user actions. */
export function UploadQueue({
  jobs,
  now,
  accountId,
  blocked,
  active,
  onRetry,
  onCancel,
  onForget,
  onVerify,
  onChallengeError,
  onError,
}: {
  jobs: UploadJob[];
  now: number;
  accountId: string;
  blocked: boolean;
  active: { jobId: string; intent: Intent } | null;
  onRetry: (id: string) => Promise<void>;
  onCancel: (job: UploadJob) => Promise<void>;
  onForget: (id: string) => Promise<void>;
  onVerify: (token: string) => Promise<void>;
  onChallengeError: (id: string, cause: unknown) => Promise<void>;
  onError: (message: string) => void;
}) {
  return (
    <>
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
                {job.accountId !== accountId && ' · ander account'}
              </p>
              {job.lastError && <p>{job.lastError}</p>}
              {!terminal(job) && job.retryAt > now && (
                <p role="status">
                  Opnieuw proberen over {Math.ceil((job.retryAt - now) / 1000)}{' '}
                  seconden.
                </p>
              )}
              {job.accountId === accountId && (
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
                        blocked ||
                        job.accountId !== accountId ||
                        job.retryAt > now
                      }
                      onClick={() => void onRetry(job.id)}
                    >
                      Opnieuw proberen
                    </button>
                    <button
                      type="button"
                      className="button ghost"
                      onClick={() =>
                        void onCancel(job).catch((e: Error) =>
                          onError(e.message),
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
                      void onForget(job.id).catch((e: Error) =>
                        onError(e.message),
                      )
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
                  onToken={(token) => void onVerify(token)}
                  onError={(message) =>
                    void onChallengeError(job.id, new Error(message))
                  }
                />
              )}
            </article>
          ))}
        </section>
      )}
    </>
  );
}
