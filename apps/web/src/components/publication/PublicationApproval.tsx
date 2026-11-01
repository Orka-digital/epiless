/** Require explicit confirmation of both the current snapshot and its visibility. */
export function PublicationApproval({
  visibility,
  confirmed,
  disabled,
  canPublish,
  busy,
  changeVisibility,
  setConfirmed,
}: {
  visibility: string;
  confirmed: boolean;
  disabled: boolean;
  canPublish: boolean;
  busy: boolean;
  changeVisibility: (value: string) => void;
  setConfirmed: (value: boolean) => void;
}) {
  return (
    <>
      <label className="field">
        Wie mag het rapport zien?
        <select
          value={visibility}
          disabled={disabled}
          onChange={(e) => {
            changeVisibility(e.target.value);
          }}
        >
          <option value="PRIVATE">Privé — alleen mijn account</option>
          <option value="UNLISTED">Via een link — iedereen met de link</option>
          <option value="PUBLIC">Openbaar — vindbaar in de index</option>
        </select>
      </label>
      <p className="notice">
        Controleer ook aangepaste paden en optionele teksten op gevoelige
        gegevens. Ruwe frames, screenshots, cookies en lokale identifiers worden
        niet opgenomen. Een gedeelde kopie kan worden doorgestuurd.
      </p>
      <label className="check-label">
        <input
          type="checkbox"
          required
          checked={confirmed}
          disabled={disabled}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span>
          Ik heb de geselecteerde inhoud en zichtbaarheid gecontroleerd en wil
          deze snapshot online bewaren.
        </span>
      </label>
      <div className="actions">
        <button className="button" type="submit" disabled={!canPublish}>
          {busy ? 'Bezig met bewaren…' : 'Rapport online bewaren'}{' '}
          <span aria-hidden="true">↗</span>
        </button>
      </div>
    </>
  );
}
