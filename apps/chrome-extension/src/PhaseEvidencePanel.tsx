import { validPhaseEvidence, validPhasePlan } from './animation-phase';
import type { Observation } from './model';

const phaseReasons: Record<string, string> = {
  DOCUMENT_PHASE_WAIT_LIMIT_REACHED:
    'Het oorspronkelijke meettijdstip ligt buiten de wachttijd van deze hercontrole.',
  CANDIDATE_PHASE_BOUNDARY_UNPROVEN:
    'Het tijdstip van de kandidaat kan niet betrouwbaar aan de gemeten pagina- en animatieklok worden gekoppeld.',
  CANDIDATE_OUTSIDE_PHASE_OBSERVATION:
    'De kandidaat valt deels buiten het interval waarin de pagina- en animatieklok werd vastgelegd.',
  PHASE_EVIDENCE_UNAVAILABLE:
    'Het oorspronkelijke tijdstip binnen de pagina- en animatiecyclus is niet vastgelegd.',
  PHASE_EVIDENCE_INCOMPLETE:
    'De pagina- of animatiecyclus kon niet volledig worden gevolgd.',
  DOCUMENT_PHASE_INTERVAL_NOT_COVERED:
    'De hercontrole heeft niet hetzelfde tijdsinterval na het laden van de pagina gemeten.',
  TRIGGER_PHASE_INTERVAL_NOT_COVERED:
    'De hercontrole heeft het oorspronkelijke tijdsinterval na de bediening niet volledig gemeten.',
  ANIMATION_PHASE_INTERVAL_NOT_COVERED:
    'De hercontrole heeft niet de volledige oorspronkelijke animatiefase bereikt.',
  ANIMATION_PHASE_IDENTITY_AMBIGUOUS:
    'De oorspronkelijke animatie kon niet eenduidig worden gekoppeld.',
  ANIMATION_TIMING_CHANGED:
    'De timing van de animatie is veranderd; deze hercontrole is niet rechtstreeks vergelijkbaar.',
  ANIMATION_TRIGGER_NOT_REPRODUCED:
    'De bediening heeft de oorspronkelijke animatie niet aantoonbaar opnieuw gestart.',
  ANIMATION_CLOCK_UNSUPPORTED:
    'De animatie gebruikt een klok die nog niet betrouwbaar wordt ondersteund.',
  ANIMATION_TIMELINE_UNSUPPORTED:
    'De animatie gebruikt een niet-ondersteunde tijdlijn, bijvoorbeeld gekoppeld aan scrollen.',
  ANIMATION_DISCOVERY_CHANGED:
    'De gevonden animaties veranderden tijdens het vastleggen van de toestand.',
  ANIMATION_DISCOVERY_INCOMPLETE:
    'Niet alle animaties konden worden onderzocht.',
  ANIMATION_PHASE_CHANGED_DURING_OBSERVATION:
    'De animatieklok veranderde tijdens de meting.',
  ANIMATION_PHASE_LIMIT_REACHED:
    'Het maximumaantal gevolgde animaties werd bereikt.',
  ANIMATION_PHASE_PENDING_LIMIT_REACHED:
    'Er waren te veel animaties zonder bekende startklok om ze volledig te blijven volgen.',
  ANIMATION_PHASE_REMOVED_UNFINISHED:
    'Een gevolgde animatie verdween voordat haar eindfase kon worden vastgesteld.',
  ANIMATION_PHASE_UNRESOLVED:
    'Bij het einde van de meting was de startklok van een animatie nog onbekend.',
  ANIMATION_PHASE_SAMPLING_GAP:
    'Er ontbreekt een deel van de bemonstering van de animatieklok.',
  ANIMATION_TARGET_UNAVAILABLE:
    'Het geanimeerde element kon niet met een herbruikbare verwijzing worden vastgelegd.',
  DOCUMENT_PHASE_CLOCK_UNAVAILABLE:
    'De documentklok kon niet betrouwbaar worden uitgelezen.',
};
export const explainPhaseReason = (reason: string): string =>
  phaseReasons[reason] ?? reason;
const time = (value: number) =>
  (value / 1000).toLocaleString('nl-BE', { maximumFractionDigits: 2 });

/** Render retained phase evidence and its limitations without replaying page effects. */
export function PhaseEvidencePanel({
  observation,
}: {
  observation: Observation;
}) {
  if (!observation.replay) return null;
  const evidence = validPhaseEvidence(observation.phaseEvidence)
    ? observation.phaseEvidence
    : undefined;
  const plan = validPhasePlan(observation.replay.phasePlan)
    ? observation.replay.phasePlan
    : undefined;
  const reasons = [
    ...new Set([
      ...(!evidence || !plan ? ['PHASE_EVIDENCE_UNAVAILABLE'] : []),
      ...(evidence?.reasons ?? []),
      ...(plan?.reasons ?? []),
    ]),
  ];
  return (
    <details className="phase-evidence">
      <summary>
        {evidence && plan?.status === 'REPLAYABLE'
          ? 'Gemeten pagina- en animatiefase'
          : 'Tijdsbewijs voor hercontrole ontbreekt of is onvolledig'}
      </summary>
      {evidence && (
        <p>
          Gemeten van {time(evidence.start.documentMs)} tot{' '}
          {time(evidence.end.documentMs)} seconden na het laden van dit
          document. {evidence.animations.length} animaties gevolgd.
        </p>
      )}
      {plan?.status === 'REPLAYABLE' && (
        <p>
          {plan.mode === 'TRIGGER'
            ? 'De hercontrole moet hetzelfde tijdsinterval na het laden van de pagina én de gemeten bediening en animatiefase opnieuw bereiken. Een start vlak na een klik bewijst niet dat de klik de oorzaak was.'
            : 'De hercontrole moet hetzelfde tijdsinterval na het laden van de pagina dekken. Alleen opnieuw laden en meteen meten volstaat niet.'}
        </p>
      )}
      {reasons.length > 0 && (
        <>
          <ul>
            {reasons.map((reason) => (
              <li key={reason}>{explainPhaseReason(reason)}</li>
            ))}
          </ul>
          <p>
            Een ontbrekende melding kan hierdoor niet worden gebruikt om het
            probleem als opgelost te beoordelen. Een nieuwe oorspronkelijke
            meting kan dit tijdsbewijs wel vastleggen.
          </p>
        </>
      )}
    </details>
  );
}
