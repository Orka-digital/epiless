import { renderFindingDiagnostics } from '@epi-less/core/diagnostics';

import { inspectSource } from './inspect-source';

import type { RouteTask } from './model';

import { TERMINAL_STATES } from './model';

import type { Finding } from '@epi-less/core';
import type { ScanMeasurements } from './ScanMeasurements';
import { VerificationPanel } from './VerificationPanel';
import type { Observation } from './model';
/** Render finding evidence; actions remain explicit callbacks owned by the workspace. */
export function ScanFinding({
  chosen,
  busy,
  active,
  act,
  devtools,
  setError,
  jobs,
  task,
  observation,
  finding,
}: Pick<
  Parameters<typeof ScanMeasurements>[0],
  'chosen' | 'busy' | 'active' | 'act' | 'devtools' | 'setError' | 'jobs'
> & { task: RouteTask; observation: Observation; finding: Finding }) {
  return (
    <div className="finding" key={finding.id}>
      <div className="finding-heading">
        <strong>
          {finding.type === 'RED_FLASH'
            ? 'Mogelijke rode flits'
            : finding.type === 'GENERAL_FLASH'
              ? 'Mogelijke lichtflits'
              : 'Animatie vraagt beoordeling'}
        </strong>
        <span>
          {(finding.startMs / 1000).toFixed(2)}–
          {(finding.endMs / 1000).toFixed(2)} s
        </span>
      </div>
      <p className="small">
        Beoordeel het gemeten gebied en de bronaanwijzingen. Het tijdstip is
        relatief aan het eerste geanalyseerde frame.
      </p>
      <details className="technical-notes">
        <summary>Oorspronkelijke detectiemelding</summary>
        <p>{finding.message}</p>
      </details>
      <div
        dangerouslySetInnerHTML={{
          __html: renderFindingDiagnostics(finding),
        }}
      />
      {finding.sourceTimeline?.candidates.some(
        (candidate) => candidate.inspectionToken,
      ) && (
        <>
          {chosen.disposableSource?.closed ? (
            <p className="small">
              De tijdelijke scantab is gesloten; de oorspronkelijke elementen
              zijn daardoor niet meer inspecteerbaar. De gemeten
              bronaanwijzingen blijven in dit rapport beschikbaar.
            </p>
          ) : devtools ? (
            <div className="actions">
              {finding.sourceTimeline.candidates.map(
                (candidate, index) =>
                  candidate.inspectionToken && (
                    <button
                      key={candidate.id}
                      disabled={
                        busy || Boolean(active && active.state !== 'PAUSED')
                      }
                      onClick={() => {
                        setError('');
                        void inspectSource(
                          candidate.inspectionToken!,
                          chosen.tabId,
                        ).catch((cause) => setError(String(cause)));
                      }}
                    >
                      Inspecteer {candidate.tag} · element {index + 1}
                    </button>
                  ),
              )}
            </div>
          ) : (
            <p className="small">
              Open DevTools → epi-less op de oorspronkelijke scantab om een
              bewaard element rechtstreeks te inspecteren. De lokale verwijzing
              vervalt wanneer de pagina of het element verandert.
            </p>
          )}
        </>
      )}
      {TERMINAL_STATES.includes(chosen.state) && !chosen.detailsExpiredAt && (
        <VerificationPanel
          job={chosen}
          anchor={{
            taskId: task.id,
            observationId: observation.id,
            findingId: finding.id,
          }}
          jobs={jobs}
          disabled={busy}
          command={act}
        />
      )}
    </div>
  );
}
