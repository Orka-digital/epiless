import { TERMINAL_STATES } from './model';

import type { ScanReportCard } from './ScanReportCard';
/** Render actions evidence; actions remain explicit callbacks owned by the workspace. */
export function ScanReportActions({
  chosen,
  busy,
  resume,
  act,
  popup,
  exportJob,
}: Pick<
  Parameters<typeof ScanReportCard>[0],
  'chosen' | 'busy' | 'resume' | 'act' | 'popup' | 'exportJob'
>) {
  return (
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
  );
}
