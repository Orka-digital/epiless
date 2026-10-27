import type { CommandAction } from './command-protocol';
import { renderFindingDiagnostics } from '@epi-less/core/diagnostics';
import {
  captureDetailSummary,
  captureWindowSummary,
} from '@epi-less/core/quality';
import { inspectSource } from './inspect-source';
import type { RouteTask } from './model';
import { TERMINAL_STATES, type ScanJob } from './model';
import { PhaseEvidencePanel } from './PhaseEvidencePanel';
import { ReplayEvidencePanel } from './ReplayEvidencePanel';
import { scenarioLabel } from './ui-labels';
import { VerificationPanel } from './VerificationPanel';
export function ScanMeasurements({
  routeView,
  setRouteView,
  chosen,
  findingsCount,
  incompleteRoute,
  visibleTasks,
  busy,
  active,
  act,
  setNotice,
  devtools,
  setError,
  jobs,
}: {
  routeView: 'all' | 'findings' | 'unreached';
  setRouteView: React.Dispatch<
    React.SetStateAction<'all' | 'findings' | 'unreached'>
  >;
  chosen: ScanJob;
  findingsCount: (job: ScanJob) => number;
  incompleteRoute: (task: ScanJob['tasks'][number]) => boolean;
  visibleTasks: RouteTask[];
  busy: boolean;
  active: ScanJob | undefined;
  act: CommandAction;
  setNotice: React.Dispatch<React.SetStateAction<string>>;
  devtools: boolean;
  setError: React.Dispatch<React.SetStateAction<string>>;
  jobs: ScanJob[];
}) {
  return (
    <div className="route-list">
      <div
        className="route-toolbar"
        role="group"
        aria-label="Metingen filteren"
      >
        <button
          aria-pressed={routeView === 'all'}
          onClick={() => setRouteView('all')}
        >
          Routes & metingen <span>{chosen.tasks.length}</span>
        </button>
        <button
          aria-pressed={routeView === 'findings'}
          onClick={() => setRouteView('findings')}
        >
          Bevindingen <span>{findingsCount(chosen)}</span>
        </button>
        <button
          aria-pressed={routeView === 'unreached'}
          onClick={() => setRouteView('unreached')}
        >
          Niet bereikt{' '}
          <span>{chosen.tasks.filter(incompleteRoute).length}</span>
        </button>
      </div>
      {!visibleTasks.length && (
        <div className="filter-empty">
          {routeView === 'findings'
            ? chosen.detailsExpiredAt
              ? 'De gedetailleerde metingen zijn verlopen. Compacte bevindingen blijven beschikbaar in de geschiedenis.'
              : 'Geen bevindingen in de bewaarde metingen. Bekijk ook de meetdekking; dit is geen veiligheidsverklaring.'
            : routeView === 'unreached'
              ? 'Geen onbereikte routes of toestanden in dit scanplan.'
              : 'Er zijn nog geen routes geregistreerd.'}
        </div>
      )}
      {visibleTasks.map((task) => (
        <details key={task.id} open={routeView === 'findings'}>
          <summary>
            <span>{new URL(task.url).pathname}</span>
            <span className="route-state">
              {
                {
                  QUEUED: 'In wachtrij',
                  RUNNING: 'Wordt onderzocht',
                  OBSERVED: 'Gemeten',
                  PARTIAL: 'Gedeeltelijk',
                  SKIPPED: 'Overgeslagen',
                }[task.state]
              }
            </span>
          </summary>
          {task.reasons.length > 0 && (
            <details className="technical-notes">
              <summary>
                Dekking en technische notities · {task.reasons.length}
              </summary>
              <ul>
                {task.reasons.map((reason, index) => (
                  <li key={index}>{reason}</li>
                ))}
              </ul>
            </details>
          )}
          {task.observations
            .filter(
              (observation) =>
                routeView !== 'findings' ||
                observation.measurement?.findings.length,
            )
            .map((observation) => (
              <div
                className="observation"
                key={observation.id}
                data-observation-id={observation.id}
              >
                <div>
                  <strong>{scenarioLabel(observation.scenario)}</strong>
                  <span>
                    {
                      {
                        NEEDS_REVIEW: 'Beoordeling nodig',
                        NO_ISSUES_OBSERVED: 'Geen bevindingen',
                        INCONCLUSIVE: 'Onvoldoende meetbewijs',
                        ERROR: 'Meting mislukt',
                      }[observation.measurement?.status ?? 'INCONCLUSIVE']
                    }
                  </span>
                </div>
                <p>
                  {observation.measurement
                    ? `${observation.measurement.quality.frameCount} frames · ${observation.measurement.quality.effectiveFps.toFixed(1)} fps · grootste gat ${Math.round(observation.measurement.quality.maxGapMs)} ms`
                    : 'Geen bruikbare meetreeks opgeslagen.'}
                </p>
                {observation.coverage && (
                  <p>
                    Dekking:{' '}
                    {observation.coverage === 'TESTED'
                      ? 'Toestand bereikt en onderzocht'
                      : observation.coverage === 'SKIPPED'
                        ? 'Overgeslagen'
                        : 'Toestand niet bereikt'}
                    {observation.replay
                      ? ` · ${observation.replay.viewport.width} × ${observation.replay.viewport.height} CSS-pixels · ${observation.replay.steps.length} bewaarde stappen`
                      : ''}
                  </p>
                )}
                {observation.replay &&
                  observation.achieved &&
                  !chosen.detailsExpiredAt &&
                  TERMINAL_STATES.includes(chosen.state) && (
                    <button
                      disabled={busy || Boolean(active)}
                      onClick={() => {
                        void act('PREPARE_RECHECK', {
                          replayOf: {
                            jobId: chosen.id,
                            taskId: task.id,
                            observationId: observation.id,
                          },
                        });
                        setNotice(
                          'Open de epi-less-toolbar op de geselecteerde scantab en kies Hercontrole starten. Chrome vereist die handeling om de capture opnieuw te autoriseren.',
                        );
                      }}
                    >
                      Dit scenario opnieuw controleren
                    </button>
                  )}
                {observation.navigation && (
                  <p>
                    Navigatieovergang: {observation.navigation.from} →{' '}
                    {observation.navigation.to}. Bevat ook beelden van de vorige
                    pagina; bronattributie is niet bevestigd.
                  </p>
                )}
                {chosen.detailsExpiredAt && (
                  <p>
                    Meetdetails verlopen op{' '}
                    {new Date(chosen.detailsExpiredAt).toLocaleDateString(
                      'nl-BE',
                    )}
                    . Compacte kandidaatstatistieken blijven in de
                    sitehistoriek.
                  </p>
                )}
                {observation.measurement?.findings.map((finding) => (
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
                      Beoordeel het gemeten gebied en de bronaanwijzingen. Het
                      tijdstip is relatief aan het eerste geanalyseerde frame.
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
                            De tijdelijke scantab is gesloten; de
                            oorspronkelijke elementen zijn daardoor niet meer
                            inspecteerbaar. De gemeten bronaanwijzingen blijven
                            in dit rapport beschikbaar.
                          </p>
                        ) : devtools ? (
                          <div className="actions">
                            {finding.sourceTimeline.candidates.map(
                              (candidate, index) =>
                                candidate.inspectionToken && (
                                  <button
                                    key={candidate.id}
                                    disabled={
                                      busy ||
                                      Boolean(
                                        active && active.state !== 'PAUSED',
                                      )
                                    }
                                    onClick={() => {
                                      setError('');
                                      void inspectSource(
                                        candidate.inspectionToken!,
                                        chosen.tabId,
                                      ).catch((cause) =>
                                        setError(String(cause)),
                                      );
                                    }}
                                  >
                                    Inspecteer {candidate.tag} · element{' '}
                                    {index + 1}
                                  </button>
                                ),
                            )}
                          </div>
                        ) : (
                          <p className="small">
                            Open DevTools → epi-less op de oorspronkelijke
                            scantab om een bewaard element rechtstreeks te
                            inspecteren. De lokale verwijzing vervalt wanneer de
                            pagina of het element verandert.
                          </p>
                        )}
                      </>
                    )}
                    {TERMINAL_STATES.includes(chosen.state) &&
                      !chosen.detailsExpiredAt && (
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
                ))}
                <details className="measurement-details">
                  <summary>Meetkwaliteit en opname</summary>
                  {observation.measurement?.quality.captureWindowMs !==
                    undefined && (
                    <p>
                      {captureWindowSummary(observation.measurement.quality)}
                    </p>
                  )}
                  {observation.measurement &&
                    captureDetailSummary(observation.measurement.quality) && (
                      <p className="fine">
                        {captureDetailSummary(observation.measurement.quality)}
                      </p>
                    )}
                  {observation.reason && <p>{observation.reason}</p>}
                  <p className="caption">Scenario-id: {observation.scenario}</p>
                </details>
                <ReplayEvidencePanel observation={observation} />
                <PhaseEvidencePanel observation={observation} />
              </div>
            ))}
          {!task.observations.length && (
            <p className="small">Deze route is nog niet gemeten.</p>
          )}
        </details>
      ))}
    </div>
  );
}
