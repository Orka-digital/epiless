import { type ScanJob } from './model';
import { ToolIcon } from './ToolIcon';
import { labels } from './ui-labels';
import type { AppState } from './ui-state';
export function ScanSidebar({
  setWorkspaceView,
  workspaceView,
  jobs,
  scanQuery,
  setScanQuery,
  chosen,
  selectScan,
  findingsCount,
  state,
}: {
  setWorkspaceView: React.Dispatch<
    React.SetStateAction<'scan' | 'history' | 'settings'>
  >;
  workspaceView: 'scan' | 'history' | 'settings';
  jobs: ScanJob[];
  scanQuery: string;
  setScanQuery: React.Dispatch<React.SetStateAction<string>>;
  chosen: ScanJob;
  selectScan: (id: string) => void;
  findingsCount: (job: ScanJob) => number;
  state: AppState | undefined;
}) {
  return (
    <aside className="tool-sidebar" aria-label="Lokale werkruimte">
      <a
        className="brand"
        href="#"
        onClick={(event) => {
          event.preventDefault();
          setWorkspaceView('scan');
        }}
      >
        <span className="brand-symbol">
          <ToolIcon name="scan" />
        </span>
        epi-less<span className="version">LOCAL</span>
      </a>
      <nav className="workspace-nav" aria-label="Werkruimtenavigatie">
        <button
          aria-current={workspaceView === 'scan' ? 'page' : undefined}
          onClick={() => setWorkspaceView('scan')}
        >
          <ToolIcon name="scan" /> Scaninspectie
        </button>
        <button
          aria-current={workspaceView === 'history' ? 'page' : undefined}
          onClick={() => setWorkspaceView('history')}
        >
          <ToolIcon name="history" /> Geschiedenis{' '}
          <span className="nav-count">{jobs.length}</span>
        </button>
        <button
          aria-current={workspaceView === 'settings' ? 'page' : undefined}
          onClick={() => setWorkspaceView('settings')}
        >
          <ToolIcon name="settings" /> Instellingen
        </button>
      </nav>
      <div className="scan-library">
        <p className="sidebar-label">SCANS OP DIT APPARAAT</p>
        <label className="scan-search">
          <ToolIcon name="search" />
          <input
            aria-label="Zoek lokale scans"
            placeholder="Zoek een website…"
            value={scanQuery}
            onChange={(event) => setScanQuery(event.target.value)}
          />
        </label>
        <div className="scan-library-list">
          {jobs
            .filter((job) =>
              job.origin.toLowerCase().includes(scanQuery.toLowerCase()),
            )
            .map((job) => (
              <button
                key={job.id}
                className={`scan-item ${chosen?.id === job.id && workspaceView === 'scan' ? 'selected' : ''}`}
                aria-current={
                  chosen?.id === job.id && workspaceView === 'scan'
                    ? 'true'
                    : undefined
                }
                onClick={() => selectScan(job.id)}
              >
                <span
                  className={`state-dot ${job.state === 'RUNNING' ? 'running' : findingsCount(job) ? 'review' : ''}`}
                />
                <span>
                  <strong>{new URL(job.origin).host}</strong>
                  <small>
                    {new Date(job.startedAt).toLocaleDateString('nl-BE', {
                      day: 'numeric',
                      month: 'short',
                    })}{' '}
                    · {labels[job.state]}
                  </small>
                </span>
              </button>
            ))}
          {!jobs.length && (
            <p className="sidebar-empty">Je scans verschijnen hier.</p>
          )}
          {!!jobs.length &&
            !jobs.some((job) =>
              job.origin.toLowerCase().includes(scanQuery.toLowerCase()),
            ) && <p className="sidebar-empty">Geen scans voor deze website.</p>}
        </div>
      </div>
      <div className="sidebar-bottom">
        <a href={state?.webOrigin || '#'} target="_blank" rel="noreferrer">
          <ToolIcon name="globe" /> Online rapporten <ToolIcon name="arrow" />
        </a>
        <span>
          <ToolIcon name="lock" /> Lokaal opgeslagen
        </span>
      </div>
    </aside>
  );
}
