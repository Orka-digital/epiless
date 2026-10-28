import type { ReactNode } from 'react';
import type { CommandAction } from './command-protocol';
import { TERMINAL_STATES, type ScanJob } from './model';
import { labels, stopSummary } from './ui-labels';
/** Present scan status and explicit lifecycle/export actions around caller-owned measurements. */
export function ScanReportCard({
  chosen,
  active,
  popup,
  busy,
  findingsCount,
  resume,
  act,
  exportJob,
  pseudonymize,
  setPseudonymize,
  webOrigin,
  children,
}: {
  chosen: ScanJob;
  active: ScanJob | undefined;
  popup: boolean;
  busy: boolean;
  findingsCount: (job: ScanJob) => number;
  resume: (job: ScanJob) => Promise<void>;
  act: CommandAction;
  exportJob: (id: string, html?: boolean) => Promise<void>;
  pseudonymize: boolean;
  setPseudonymize: (value: boolean) => void;
  webOrigin: string | undefined;
  children?: ReactNode;
}) {
  return (
    <section className="audit-card" aria-labelledby="audit-title">
      <div className="card-heading">
        <div>
          <p className="label">
            {active?.id === chosen.id ? 'ACTIEVE SCAN' : 'SCANRAPPORT'}
          </p>
          <h2 id="audit-title">{new URL(chosen.origin).host}</h2>
        </div>
        <span
          className={`status ${chosen.state === 'RUNNING' ? 'active' : ''}`}
        >
          {labels[chosen.state]}
        </span>
      </div>
      <p className="audit-date">
        {new Date(chosen.startedAt).toLocaleString('nl-BE')} ·{' '}
        {chosen.mode === 'AUTONOMOUS'
          ? 'Autonome websitescan'
          : 'Viewportmeting'}
      </p>
      <div className="stats">
        <div className={findingsCount(chosen) ? 'metric-review' : ''}>
          <strong>{findingsCount(chosen)}</strong>
          <span>bevindingen ter beoordeling</span>
        </div>
        <div>
          <strong>
            {
              chosen.tasks.filter((task) =>
                ['OBSERVED', 'PARTIAL'].includes(task.state),
              ).length
            }
            <span> / {chosen.tasks.length}</span>
          </strong>
          <span>routes bezocht</span>
        </div>
        <div>
          <strong>
            {chosen.tasks.reduce(
              (sum, task) => sum + task.observations.length,
              0,
            )}
          </strong>
          <span>observaties</span>
        </div>
        <div>
          <strong>
            {`${Math.floor(chosen.elapsedMs / 60_000)}:${String(Math.floor(chosen.elapsedMs / 1000) % 60).padStart(2, '0')}`}
          </strong>
          <span>actieve scantijd</span>
        </div>
      </div>
      <p className="small">
        {chosen.tasks.find((task) => task.state === 'RUNNING')?.url ??
          stopSummary(chosen.stopReason)}
      </p>
      {chosen.disposableSource?.closed && (
        <p className="small">
          De tijdelijke scantab is gesloten. De oorspronkelijke tab bleef
          behouden. Je kunt het rapport bekijken of een bewaard scenario opnieuw
          laten onderzoeken.
        </p>
      )}
      {chosen.disposableSource && chosen.state === 'PAUSED' && (
        <p className="small">
          De tijdelijke scantab blijft open tijdens de pauze. Je kunt daar
          DevTools openen om nog beschikbare bronelementen te inspecteren. Sluit
          DevTools voordat je via de toolbar hervat.
        </p>
      )}
      {chosen.disposableSource?.cleanupStatus === 'MANUAL' && (
        <p className="message">
          Het automatisch sluiten van de tijdelijke scantab kon niet worden
          bevestigd. Controleer of die tab nog openstaat; het rapport is
          bewaard.
        </p>
      )}
      <div className="actions">
        {chosen.state === 'RUNNING' && (
          <button
            disabled={busy}
            onClick={() => void act('PAUSE', { id: chosen.id })}
          >
            Pauzeer
          </button>
        )}
        {['PAUSED', 'INTERRUPTED'].includes(chosen.state) &&
          !chosen.disposableSource?.closed && (
            <button disabled={busy} onClick={() => void resume(chosen)}>
              Hervat via scantab
            </button>
          )}
        {!TERMINAL_STATES.includes(chosen.state) && (
          <button
            className="danger"
            disabled={busy || chosen.state === 'STOPPING'}
            onClick={() => void act('STOP', { id: chosen.id })}
          >
            Stop scan
          </button>
        )}
        {popup && (
          <button onClick={() => void act('OPEN_DASHBOARD')}>
            Bekijk voortgang ↗
          </button>
        )}
        {!popup && TERMINAL_STATES.includes(chosen.state) && (
          <>
            <button onClick={() => void exportJob(chosen.id)}>
              Exporteer JSON
            </button>
            <button onClick={() => void exportJob(chosen.id, true)}>
              Exporteer HTML
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void act('PUBLISH_PREVIEW', { id: chosen.id })}
            >
              Uploadvoorbeeld openen ↗
            </button>
          </>
        )}
      </div>
      {!popup && TERMINAL_STATES.includes(chosen.state) && (
        <details className="export-options">
          <summary>Privacy- en exportopties</summary>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={pseudonymize}
              onChange={(event) => setPseudonymize(event.target.checked)}
            />{' '}
            Vervang websites, paden en diagnostische tekst in exports door
            pseudoniemen
          </label>
          <p className="caption">
            Pseudonimisering geldt voor lokale exports, niet voor het
            uploadvoorbeeld. Tijdstippen en metingen blijven behouden.
          </p>
          <p className="caption">
            Delen opent eerst een voorbeeld op {webOrigin}. Er wordt nu nog
            niets gepubliceerd.
          </p>
        </details>
      )}
      {children}
      {!popup && (
        <details className="limitations">
          <summary>Meetgrenzen en dekking</summary>
          {chosen.stopReason && (
            <p>
              Technische afsluitreden: <code>{chosen.stopReason}</code>
            </p>
          )}
          <ul>
            {chosen.limitations.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p className="small">
            Een afgeronde job betekent dat het scanplan is uitgevoerd. Onbekende
            pagina’s en niet bereikte toestanden blijven onbekend.
          </p>
        </details>
      )}
    </section>
  );
}
