import type { Observation } from './model';
import {
  mediaPlanFromEvidence,
  validMediaEvidence,
  validMediaPlan,
} from './media-replay';

const mediaReasons: Record<string, string> = {
  MEDIA_EVIDENCE_UNAVAILABLE:
    'De oorspronkelijke videometing ontbreekt of is niet bruikbaar.',
  MEDIA_DISCOVERY_OR_OBSERVATION_INCOMPLETE:
    'Niet alle video’s of het volledige meetinterval konden worden gevolgd.',
  MEDIA_DISCOVERY_INCOMPLETE:
    'Niet alle video’s op de pagina konden worden onderzocht.',
  MEDIA_NOT_SEEKABLE_FILE:
    'De video kan niet betrouwbaar op dezelfde afspeelpositie worden gezet.',
  MEDIA_PRESENTATION_COVERAGE_UNPROVEN:
    'Er is onvoldoende bewijs dat alle oorspronkelijke videobeelden opnieuw aangeboden kunnen worden.',
  MEDIA_INTERVAL_NOT_REPRODUCIBLE:
    'Het gemeten afspeelverloop kan niet betrouwbaar worden herhaald.',
  MEDIA_SEEK_DURING_OBSERVATION:
    'Tijdens de meting versprong de afspeelpositie.',
  MEDIA_LOOP_SEEK_UNPROVEN:
    'Een sprong in de afspeelpositie kon niet als doorlopende videoherhaling worden bevestigd.',
  MEDIA_PRESENTATION_DISCONTINUITY:
    'De browser rapporteerde een onderbreking in de aangeboden videobeelden.',
  MEDIA_SOURCE_OR_LOOP_CHANGED:
    'De videobron of herhaalstand veranderde tijdens de meting.',
  MEDIA_SOURCE_OR_RATE_CHANGED:
    'De videobron of afspeelsnelheid veranderde tijdens de meting.',
  MEDIA_MEMBERSHIP_CHANGED:
    'Er kwamen video’s bij of er verdwenen video’s tijdens de meting.',
  MEDIA_NODE_REPLACED:
    'De oorspronkelijke videospeler werd tijdens de meting vervangen.',
  MEDIA_PATH_UNAVAILABLE:
    'De videospeler kon niet met een herbruikbare elementverwijzing worden vastgelegd.',
  MEDIA_CAPTURE_BOUNDARY_UNAVAILABLE:
    'Het begin van de videometing kon niet aan de beeldcapture worden gekoppeld.',
  MEDIA_OBSERVATION_CANCELLED: 'De videometing werd onderbroken.',
  MEDIA_OBSERVATION_TIMEOUT:
    'De maximale duur voor het volgen van de video werd bereikt.',
  MEDIA_LIMIT_REACHED:
    'Het maximumaantal gelijktijdig gevolgde video’s werd bereikt.',
  MEDIA_TIME_LIMIT_REACHED: 'De videotijd ligt buiten het ondersteunde bereik.',
  MEDIA_SEEK_LIMIT_REACHED:
    'Er waren te veel sprongen in de afspeelpositie om ze volledig te volgen.',
  MEDIA_SAMPLE_LIMIT_REACHED:
    'De opslaggrens voor afspeelposities werd bereikt.',
  MEDIA_PRESENTATION_LIMIT_REACHED:
    'De opslaggrens voor aangeboden videobeelden werd bereikt.',
};
const seconds = (ms: number) =>
  (ms / 1000).toLocaleString('nl-BE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/** Local diagnostic evidence; this component never changes comparison eligibility. */
export function ReplayEvidencePanel({
  observation,
}: {
  observation: Observation;
}) {
  const evidence = validMediaEvidence(observation.mediaEvidence)
    ? observation.mediaEvidence
    : undefined;
  const plan = validMediaPlan(observation.replay?.mediaPlan)
    ? observation.replay.mediaPlan
    : observation.mediaEvidence
      ? mediaPlanFromEvidence(observation.mediaEvidence)
      : undefined;
  if (!plan || (plan.status === 'REPLAYABLE' && plan.items.length === 0))
    return null;
  const reasons = [...new Set([...plan.reasons, ...(evidence?.reasons ?? [])])];
  return (
    <details className="replay-evidence">
      <summary>
        {plan.status === 'REPLAYABLE'
          ? 'Videotijdcodes voor hercontrole beschikbaar'
          : 'Videometing niet betrouwbaar herhaalbaar'}
      </summary>
      <p>
        {plan.status === 'REPLAYABLE'
          ? 'Een hercontrole moet het oorspronkelijke afspeelinterval en de aangeboden videobeelden daadwerkelijk opnieuw bereiken. Dit wordt na de hercontrole gecontroleerd.'
          : 'Een nieuwe scan kan nog steeds bevindingen opleveren. Als het oorspronkelijke videoverloop niet vergelijkbaar is, bewijst het uitblijven van een melding geen herstel.'}
      </p>
      {reasons.length > 0 && (
        <ul>
          {reasons.map((reason) => (
            <li key={reason}>
              {mediaReasons[reason] ??
                'Een aanvullende meetgrens verhindert een sluitende videohercontrole.'}
            </li>
          ))}
        </ul>
      )}
      {evidence?.items.map((item, index) => {
        const first = item.samples[0];
        const last = item.samples.at(-1);
        const presentations = item.presentations ?? [];
        return (
          <p key={index}>
            <strong>Video {index + 1}.</strong>{' '}
            {first && last
              ? `Gemonsterde afspeelpositie: ${seconds(first.timeMs)} s bij het begin, ${seconds(last.timeMs)} s bij het einde.`
              : 'Geen bruikbare reeks afspeelposities.'}{' '}
            {presentations.length > 0
              ? `De browser meldde ${presentations.length} videopresentaties; eerste tijdcode ${seconds(presentations[0].timeMs)} s, laatste ${seconds(presentations.at(-1)!.timeMs)} s.`
              : 'Geen videopresentaties door de browser vastgelegd.'}
          </p>
        );
      })}
      <p className="small">
        Deze tijdcodes horen bij de video. Ze tellen geen geanalyseerde
        schermbeelden en bewijzen niet dat twee videobestanden dezelfde inhoud
        hebben.
      </p>
      {reasons.length > 0 && (
        <details>
          <summary>Technische meetcodes</summary>
          <p className="small">{reasons.join(' · ')}</p>
        </details>
      )}
    </details>
  );
}
