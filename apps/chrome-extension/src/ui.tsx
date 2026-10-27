import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TERMINAL_STATES, type ScanJob } from './model';
import { ScanHistory } from './ScanHistory';
import { ScanMeasurements } from './ScanMeasurements';
import { ScanSettings } from './ScanSettings';
import { ScanSidebar } from './ScanSidebar';
import { ScanStart } from './ScanStart';
import { ToolIcon } from './ToolIcon';
import { labels, stopSummary } from './ui-labels';
import { useScanExports } from './useScanExports';
import { useScannerConnection } from './useScannerConnection';
import { useScanSelection } from './useScanSelection';

function App() {
  const advancedBuild =
    chrome.runtime.getManifest().permissions?.includes('debugger') ?? false;
  const [advancedPointer, setAdvancedPointer] = useState(false);
  const view = document.body.dataset.view;
  const popup = view === 'popup';
  const devtools = view === 'panel';
  const {
    state,
    error,
    setError,
    notice,
    setNotice,
    busy,
    mode,
    setMode,
    viewportSeconds,
    setViewportSeconds,
    act,
    start: startScan,
    resume: resumeScan,
  } = useScannerConnection(devtools);
  const {
    jobs,
    active,
    recheck,
    advancedPreparation,
    chosen,
    popupReport,
    findingsCount,
    selectScan,
    incompleteRoute,
    visibleTasks,
    targetOrigin,
    site,
    setSite,
    workspaceView,
    setWorkspaceView,
    routeView,
    setRouteView,
    scanQuery,
    setScanQuery,
    deletion,
    setDeletion,
  } = useScanSelection(state, popup);
  const { pseudonymize, setPseudonymize, exportJob, exportHistory } =
    useScanExports(setError);
  const useAdvanced =
    advancedBuild && (!!advancedPreparation || advancedPointer);
  const start = () =>
    startScan({ targetOrigin, useAdvanced, advancedPreparation, recheck });
  const resume = (job: ScanJob) => resumeScan(job, popup);
  return (
    <div className={popup ? 'popup-shell' : 'tool-shell'}>
      {!popup && (
        <ScanSidebar
          setWorkspaceView={setWorkspaceView}
          workspaceView={workspaceView}
          jobs={jobs}
          scanQuery={scanQuery}
          setScanQuery={setScanQuery}
          chosen={chosen}
          selectScan={selectScan}
          findingsCount={findingsCount}
          state={state}
        />
      )}
      <main>
        <header className="tool-header">
          {popup ? (
            <a
              className="brand"
              href="#"
              onClick={(event) => {
                event.preventDefault();
                void act('OPEN_DASHBOARD');
              }}
            >
              <span className="brand-symbol">
                <ToolIcon name="scan" />
              </span>
              epi-less
            </a>
          ) : (
            <div className="breadcrumb">
              Lokale werkruimte <span>/</span>{' '}
              <h1>
                {workspaceView === 'history'
                  ? 'Geschiedenis'
                  : workspaceView === 'settings'
                    ? 'Instellingen'
                    : 'Scaninspectie'}
              </h1>
            </div>
          )}
          {popup ? (
            <button
              className="icon-button"
              aria-label="Open werkruimte"
              title="Open werkruimte"
              onClick={() => void act('OPEN_DASHBOARD')}
            >
              <ToolIcon name="external" />
            </button>
          ) : (
            <span className="preview-tag">Ontwikkelversie</span>
          )}
        </header>
        <div className="workspace-content">
          {popup && <h1 className="sr-only">Website scannen</h1>}
          {error && (
            <div role="alert" className="message error">
              {error}
            </div>
          )}
          {notice && (
            <div role="status" className="message">
              {notice}
            </div>
          )}
          {state?.advancedRecovery && (
            <section role="status" className="message">
              <strong>Tijdelijke scantab controleren</strong>
              <p>
                epi-less kon de tijdelijke scantab niet meer met zekerheid
                herkennen en heeft daarom geen tab gesloten. Controleer de open
                scantab voordat je opnieuw begint.
              </p>
              <details>
                <summary>Technische reden</summary>
                <p>{state.advancedRecovery.reason}</p>
              </details>
            </section>
          )}
          {!!state?.workspaceRecovery?.length && (
            <section role="status" className="message">
              <strong>Scantab handmatig terugplaatsen</strong>
              <p>
                De scan werd onderbroken tijdens het verplaatsen van een tab.
                epi-less kan het tijdelijke venster niet meer betrouwbaar
                herkennen. Sleep de scantab zelf terug naar het oorspronkelijke
                venster. Deze melding verdwijnt zodra de tab daar terugstaat.
              </p>
              <ul>
                {state.workspaceRecovery.map((recovery) => (
                  <li key={recovery.jobId}>
                    {jobs.find((job) => job.id === recovery.jobId)?.startUrl ??
                      'Onderbroken scan'}{' '}
                    · oorspronkelijke tabpositie {recovery.originalIndex + 1}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(popup || devtools) &&
            workspaceView === 'scan' &&
            (popup ? !popupReport : !active) && (
              <ScanStart
                devtools={devtools}
                targetOrigin={targetOrigin}
                recheck={recheck}
                busy={busy}
                advancedPreparation={advancedPreparation}
                act={act}
                mode={mode}
                setMode={setMode}
                viewportSeconds={viewportSeconds}
                setViewportSeconds={setViewportSeconds}
                advancedBuild={advancedBuild}
                useAdvanced={useAdvanced}
                setAdvancedPointer={setAdvancedPointer}
                start={start}
              />
            )}
          {!popup && workspaceView === 'scan' && !chosen && !devtools && (
            <section className="workspace-empty">
              <span className="empty-symbol">
                <ToolIcon name="scan" />
              </span>
              <p className="label">NOG GEEN LOKALE SCANS</p>
              <h2>Je onderzoek begint op een website.</h2>
              <p>
                Open de website die je wilt onderzoeken. Klik op epi-less naast
                de adresbalk en kies <strong>Scan deze website</strong>.
              </p>
              <div className="empty-steps">
                <span>
                  <b>1</b> Open een website
                </span>
                <span>
                  <b>2</b> Start via de extensie
                </span>
                <span>
                  <b>3</b> Onderzoek hier de resultaten
                </span>
              </div>
              <a
                href={`${state?.webOrigin || ''}/docs`}
                target="_blank"
                rel="noreferrer"
              >
                Handleiding openen <ToolIcon name="arrow" />
              </a>
            </section>
          )}
          {popup && !popupReport && chosen && (
            <button
              className="last-scan"
              onClick={() => void act('OPEN_DASHBOARD')}
            >
              <ToolIcon name="history" />
              <span>
                <small>Laatste scan</small>
                <strong>{new URL(chosen.origin).host}</strong>
              </span>
              <ToolIcon name="arrow" />
            </button>
          )}
          {chosen && workspaceView === 'scan' && (!popup || popupReport) && (
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
                  De tijdelijke scantab is gesloten. De oorspronkelijke tab
                  bleef behouden. Je kunt het rapport bekijken of een bewaard
                  scenario opnieuw laten onderzoeken.
                </p>
              )}
              {chosen.disposableSource && chosen.state === 'PAUSED' && (
                <p className="small">
                  De tijdelijke scantab blijft open tijdens de pauze. Je kunt
                  daar DevTools openen om nog beschikbare bronelementen te
                  inspecteren. Sluit DevTools voordat je via de toolbar hervat.
                </p>
              )}
              {chosen.disposableSource?.cleanupStatus === 'MANUAL' && (
                <p className="message">
                  Het automatisch sluiten van de tijdelijke scantab kon niet
                  worden bevestigd. Controleer of die tab nog openstaat; het
                  rapport is bewaard.
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
                      onClick={() =>
                        void act('PUBLISH_PREVIEW', { id: chosen.id })
                      }
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
                      onChange={(event) =>
                        setPseudonymize(event.target.checked)
                      }
                    />{' '}
                    Vervang websites, paden en diagnostische tekst in exports
                    door pseudoniemen
                  </label>
                  <p className="caption">
                    Pseudonimisering geldt voor lokale exports, niet voor het
                    uploadvoorbeeld. Tijdstippen en metingen blijven behouden.
                  </p>
                  <p className="caption">
                    Delen opent eerst een voorbeeld op {state?.webOrigin}. Er
                    wordt nu nog niets gepubliceerd.
                  </p>
                </details>
              )}
              {!popup && (
                <ScanMeasurements
                  routeView={routeView}
                  setRouteView={setRouteView}
                  chosen={chosen}
                  findingsCount={findingsCount}
                  incompleteRoute={incompleteRoute}
                  visibleTasks={visibleTasks}
                  busy={busy}
                  active={active}
                  act={act}
                  setNotice={setNotice}
                  devtools={devtools}
                  setError={setError}
                  jobs={jobs}
                />
              )}
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
                    Een afgeronde job betekent dat het scanplan is uitgevoerd.
                    Onbekende pagina’s en niet bereikte toestanden blijven
                    onbekend.
                  </p>
                </details>
              )}
            </section>
          )}
          {!popup && workspaceView === 'history' && (
            <ScanHistory
              jobs={jobs}
              site={site}
              setSite={setSite}
              state={state}
              exportHistory={exportHistory}
              setDeletion={setDeletion}
              deletion={deletion}
              busy={busy}
              act={act}
              selectScan={selectScan}
            />
          )}
          {!popup && workspaceView === 'settings' && (
            <ScanSettings busy={busy} state={state} act={act} />
          )}
          <details className="measurement-note">
            <summary>
              <ToolIcon name="info" /> Meetgrenzen · ontwikkelversie
            </summary>
            <p>
              Een scan beschrijft uitsluitend de onderzochte beelden en
              toestanden. Onvoldoende frames of ontbrekende dekking geven een
              onbeslisbare meting. De detector is nog niet normatief
              gevalideerd; een resultaat is geen veiligheidskeurmerk.
            </p>
          </details>
        </div>
        <footer>
          <span>
            <ToolIcon name="lock" /> Lokaal · geen video-opslag
          </span>
          {!popup && <span>epi-less</span>}
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
