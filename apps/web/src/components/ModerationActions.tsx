import { useEffect, useState } from 'react';
import { api } from '../lib/client-api';

export default function ModerationActions({
  id,
  revision,
  active,
}: {
  id: string;
  revision: number;
  active: boolean;
}) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [action, setAction] = useState<'hide' | 'dismiss'>(
    active ? 'hide' : 'dismiss',
  );
  const [reason, setReason] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reviewed) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/publications/${id}/moderate`, {
        action,
        reason,
        revision,
      });
      setDone(true);
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }
  if (done)
    return (
      <div className="notice success" role="status">
        <p>
          {action === 'hide'
            ? 'Het rapport is verborgen voor bezoekers. De beslissing is vastgelegd.'
            : 'De melding is afgesloten. De rapportinhoud en meetuitkomst zijn ongewijzigd.'}
        </p>
        <a href="/account/moderation">Terug naar de meldingen</a>
      </div>
    );
  return (
    <form className="form-panel" onSubmit={submit} method="post">
      <noscript>
        <p className="notice">
          Schakel JavaScript in om een moderatiebeslissing veilig op te slaan.
        </p>
      </noscript>
      <h2>Leg je beoordeling vast.</h2>
      <fieldset className="form-fields" disabled={!hydrated || busy}>
        <legend className="sr-only">Moderatiebeslissing</legend>
        <label className="field">
          Beslissing
          <select
            value={action}
            onChange={(event) =>
              setAction(event.target.value as 'hide' | 'dismiss')
            }
            disabled={busy}
          >
            {active && (
              <option value="hide">
                Rapport verbergen en melding afsluiten
              </option>
            )}
            <option value="dismiss">
              Melding afsluiten zonder rapportwijziging
            </option>
          </select>
        </label>
        <label className="field">
          Reden
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={4}
            minLength={10}
            maxLength={2000}
            required
            disabled={busy}
          />
          <small>
            Deze reden wordt opgeslagen. Bij verbergen kan de eigenaar de reden
            lezen. Voeg geen extra persoonsgegevens toe.
          </small>
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(event) => setReviewed(event.target.checked)}
            required
            disabled={busy}
          />{' '}
          Ik heb het rapport, de scope en de melding beoordeeld.
        </label>
        <div className="actions">
          <button
            className={`button ${action === 'hide' ? 'danger' : ''}`}
            disabled={busy || !reviewed}
          >
            {busy
              ? 'Opslaan…'
              : action === 'hide'
                ? 'Verberg rapport'
                : 'Sluit melding af'}
          </button>
          <a href="/account/moderation">Terug naar overzicht</a>
        </div>
      </fieldset>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
