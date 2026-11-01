import type { CommandAction } from './command-protocol';
import type { RouteTask } from './model';
import { type ScanJob } from './model';
import { ScanObservation } from './ScanObservation';
/** Render route coverage and measured candidates without presenting an untested route as safe. */
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
              <ScanObservation
                key={observation.id}
                {...{
                  chosen,
                  busy,
                  active,
                  act,
                  setNotice,
                  devtools,
                  setError,
                  jobs,
                  task,
                  observation,
                }}
              />
            ))}
          {!task.observations.length && (
            <p className="small">Deze route is nog niet gemeten.</p>
          )}
        </details>
      ))}
    </div>
  );
}
