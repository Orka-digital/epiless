import { ToolHeader } from './ToolHeader';
import { ScanRecoveryNotices } from './ScanRecoveryNotices';
import { ScanReportCard } from './ScanReportCard';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ScanJob } from './model';
import { ScanHistory } from './ScanHistory';
import { ScanMeasurements } from './ScanMeasurements';
import { ScanSettings } from './ScanSettings';
import { ScanSidebar } from './ScanSidebar';
import { ScanStart } from './ScanStart';
import { ToolIcon } from './ToolIcon';
import { useScanExports } from './useScanExports';
import { useScannerConnection } from './useScannerConnection';
import { useScanSelection } from './useScanSelection';

/** Compose workspace sections while hooks retain connection, selection and export ownership. */
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
        <ToolHeader popup={popup} workspaceView={workspaceView} act={act} />
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
          <ScanRecoveryNotices state={state} jobs={jobs} />
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
            <ScanReportCard
              chosen={chosen}
              active={active}
              popup={popup}
              busy={busy}
              findingsCount={findingsCount}
              resume={resume}
              act={act}
              exportJob={exportJob}
              pseudonymize={pseudonymize}
              setPseudonymize={setPseudonymize}
              webOrigin={state?.webOrigin}
            >
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
            </ScanReportCard>
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
