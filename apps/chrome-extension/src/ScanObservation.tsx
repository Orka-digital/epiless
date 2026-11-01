import { ScanFinding } from './ScanFinding';

import {
  captureDetailSummary,
  captureWindowSummary,
} from '@epi-less/core/quality';

import type { RouteTask } from './model';

import { TERMINAL_STATES } from './model';

import { PhaseEvidencePanel } from './PhaseEvidencePanel';

import { ReplayEvidencePanel } from './ReplayEvidencePanel';

import { scenarioLabel } from './ui-labels';

import type { ScanMeasurements } from './ScanMeasurements';
import type { Observation } from './model';
/** Render observation evidence; actions remain explicit callbacks owned by the workspace. */
export function ScanObservation({
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
}: Pick<
  Parameters<typeof ScanMeasurements>[0],
  | 'chosen'
  | 'busy'
  | 'active'
  | 'act'
  | 'devtools'
  | 'setError'
  | 'jobs'
  | 'setNotice'
> & { task: RouteTask; observation: Observation }) {
  return (
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
          Dekking: {coverageLabel(observation.coverage)}
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
          {observation.navigation.to}. Bevat ook beelden van de vorige pagina;
          bronattributie is niet bevestigd.
        </p>
      )}
      {chosen.detailsExpiredAt && (
        <p>
          Meetdetails verlopen op{' '}
          {new Date(chosen.detailsExpiredAt).toLocaleDateString('nl-BE')}.
          Compacte kandidaatstatistieken blijven in de sitehistoriek.
        </p>
      )}
      {observation.measurement?.findings.map((finding) => (
        <ScanFinding
          key={finding.id}
          {...{
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
          }}
        />
      ))}
      <details className="measurement-details">
        <summary>Meetkwaliteit en opname</summary>
        {observation.measurement?.quality.captureWindowMs !== undefined && (
          <p>{captureWindowSummary(observation.measurement.quality)}</p>
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
  );
}

function coverageLabel(coverage: Observation['coverage']): string {
  return coverage === 'TESTED'
    ? 'Toestand bereikt en onderzocht'
    : coverage === 'SKIPPED'
      ? 'Overgeslagen'
      : 'Toestand niet bereikt';
}
