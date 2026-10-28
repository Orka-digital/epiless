import type { PublicationResult } from '../../lib/upload-queue';
/** Show the actual server outcome, including publications completed before cancellation. */
export function PublicationResultNotice({
  result,
}: {
  result: PublicationResult;
}) {
  return (
    <div className="notice success" role="status">
      <h2>
        {result.state && result.state !== 'ACTIVE'
          ? 'Deze opdracht was al verwerkt.'
          : 'Je rapport staat online.'}
      </h2>
      <p>
        {result.state && result.state !== 'ACTIVE'
          ? 'Het rapport is inmiddels ingetrokken of afgeschermd. Opnieuw proberen maakt het niet opnieuw zichtbaar.'
          : result.visibility === 'PRIVATE'
            ? 'Alleen jouw account heeft toegang.'
            : result.visibility === 'PUBLIC'
              ? 'Het rapport is opgenomen in de openbare index.'
              : 'Iedereen met de deellink kan dit rapport bekijken.'}
      </p>
      <div className="actions">
        <a className="button" href={result.shareUrl || `/reports/${result.id}`}>
          Open het rapport <span aria-hidden="true">↗</span>
        </a>
        <a href="/account">Mijn rapporten beheren</a>
      </div>
    </div>
  );
}
