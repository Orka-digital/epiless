import type { ScanJob } from './model';
import type { AppState } from './ui-state';
/** Explain uncertain tab ownership without claiming automatic restoration succeeded. */
export function ScanRecoveryNotices({
  state,
  jobs,
}: {
  state: AppState | undefined;
  jobs: ScanJob[];
}) {
  return (
    <>
      {state?.advancedRecovery && (
        <section role="status" className="message">
          <strong>Tijdelijke scantab controleren</strong>
          <p>
            epi-less kon de tijdelijke scantab niet meer met zekerheid herkennen
            en heeft daarom geen tab gesloten. Controleer de open scantab
            voordat je opnieuw begint.
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
            epi-less kan het tijdelijke venster niet meer betrouwbaar herkennen.
            Sleep de scantab zelf terug naar het oorspronkelijke venster. Deze
            melding verdwijnt zodra de tab daar terugstaat.
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
    </>
  );
}
