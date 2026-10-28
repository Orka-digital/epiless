import type { CommandAction } from './command-protocol';
import { TERMINAL_STATES, type ScanJob } from './model';
import { labels } from './ui-labels';
import type { AppState } from './ui-state';
/** Render retained job summaries and dispatch explicit selection/export actions. */
export function ScanHistory({
  jobs,
  site,
  setSite,
  state,
  exportHistory,
  setDeletion,
  deletion,
  busy,
  act,
  selectScan,
}: {
  jobs: ScanJob[];
  site: string;
  setSite: React.Dispatch<React.SetStateAction<string>>;
  state: AppState | undefined;
  exportHistory: (origin?: string) => Promise<void>;
  setDeletion: React.Dispatch<
    React.SetStateAction<{ origin?: string; id?: string } | undefined>
  >;
  deletion: { origin?: string; id?: string } | undefined;
  busy: boolean;
  act: CommandAction;
  selectScan: (id: string) => void;
}) {
  return (
    <section className="history">
      <div className="card-heading">
        <h2>Lokale geschiedenis</h2>
        <span>{jobs.length} scans</span>
      </div>
      <label className="field">
        Website
        <select
          aria-label="Website"
          value={site}
          onChange={(event) => setSite(event.target.value)}
        >
          <option value="">Alle websites</option>
          {state?.sites.map((summary) => (
            <option key={summary.origin} value={summary.origin}>
              {summary.origin}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button disabled={!jobs.length} onClick={() => void exportHistory()}>
          Exporteer volledige index
        </button>
        {site && (
          <>
            <button onClick={() => void exportHistory(site)}>
              Exporteer sitehistoriek
            </button>
            <button
              className="danger"
              onClick={() => setDeletion({ origin: site })}
            >
              Wis website
            </button>
          </>
        )}
        <button
          className="danger"
          disabled={!jobs.length}
          onClick={() => setDeletion({})}
        >
          Wis alle lokale data
        </button>
      </div>
      {deletion && (
        <div
          className="message"
          role="group"
          aria-label="Verwijderen bevestigen"
        >
          <p>
            {deletion.id
              ? 'Deze lokale audit verwijderen?'
              : deletion.origin
                ? `Alle lokale audits van ${deletion.origin} verwijderen?`
                : 'Alle lokale audits, overdrachten en bewaarinstellingen verwijderen?'}{' '}
            Deze actie kun je niet ongedaan maken. Online rapporten blijven
            behouden.
          </p>
          <div className="actions">
            <button
              className="danger"
              disabled={busy}
              onClick={() => {
                void (deletion.id
                  ? act('DELETE', { id: deletion.id })
                  : act('DELETE_HISTORY', { origin: deletion.origin }));
                setDeletion(undefined);
              }}
            >
              Bevestig verwijderen
            </button>
            <button onClick={() => setDeletion(undefined)}>Annuleer</button>
          </div>
        </div>
      )}
      {(state?.sites ?? [])
        .filter((summary) => !site || summary.origin === site)
        .map((summary) => (
          <details
            className="site-summary"
            key={summary.origin}
            open={Boolean(site)}
          >
            <summary>
              <strong>{summary.origin}</strong> · {summary.attempts} audits ·{' '}
              {summary.uniqueCandidates} kandidaten / {summary.occurrences}{' '}
              waarnemingen
            </summary>
            <dl className="summary-grid">
              <dt>Routes gemeten / geïndexeerd</dt>
              <dd>
                {summary.measuredRoutes} / {summary.indexedRoutes}
              </dd>
              <dt>Auditpogingen / afgerond</dt>
              <dd>
                {summary.attempts} / {summary.completedAudits}
              </dd>
              <dt>Scenario's</dt>
              <dd>{summary.scenarios}</dd>
              <dt>Lokaal bevestigde problemen</dt>
              <dd>{summary.confirmedIssues}</dd>
              <dt>Beoordeeld als opgelost / teruggekeerd</dt>
              <dd>
                {summary.resolvedIssues} / {summary.regressedIssues}
              </dd>
              <dt>Beoordeeld als geen probleem</dt>
              <dd>{summary.dismissedCandidates}</dd>
              <dt>Toereikende kwaliteit bij afgeronde audits</dt>
              <dd>
                {summary.qualityRatio === null
                  ? 'Geen afgeronde audits'
                  : `${Math.round(summary.qualityRatio * 100)}% (${summary.qualityAudits} / ${summary.completedAudits})`}
              </dd>
              <dt>Laatste audit</dt>
              <dd>
                {new Date(summary.latestAuditAt).toLocaleString('nl-BE')} ·{' '}
                {labels[summary.latestJobState]}
              </dd>
            </dl>
            <p className="small">
              Kandidaten worden lokaal gegroepeerd op route, scenario, engine,
              beeldformaat, type en exact pixelgebied. Dit is geen bevestigde
              elementidentiteit. Herhaalde detecties tellen als waarnemingen;
              niet gezien betekent niet opgelost. Herstel en terugkeer vereisen
              vergelijkbare gerichte hercontroles en jouw expliciete
              beoordeling. Dit zijn geen WCAG-oordelen.
            </p>
          </details>
        ))}
      {jobs.length === 0 ? (
        <p>
          Open de epi-less-toolbar op een website om je eerste scan te starten.
        </p>
      ) : (
        jobs
          .filter((job) => !site || job.origin === site)
          .map((job) => (
            <div className="history-row" key={job.id}>
              <button
                className="history-select"
                onClick={() => selectScan(job.id)}
              >
                <strong>{new URL(job.origin).host}</strong>
                <span>
                  {new Date(job.startedAt).toLocaleString('nl-BE')} ·{' '}
                  {labels[job.state]}
                </span>
              </button>
              {TERMINAL_STATES.includes(job.state) && (
                <button
                  className="quiet"
                  aria-label={`Verwijder scan van ${job.origin} op ${new Date(job.startedAt).toLocaleString('nl-BE')}`}
                  onClick={() => setDeletion({ id: job.id })}
                >
                  Verwijder
                </button>
              )}
            </div>
          ))
      )}
    </section>
  );
}
