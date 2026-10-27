import { useEffect, useState } from 'react';
import { api } from '../lib/client-api';
export default function AccountActions({
  id,
  revision,
  active,
  shareUrl,
  visibility,
  publicAccessNeedsConfirmation = false,
}: {
  id: string;
  revision: number;
  active: boolean;
  shareUrl?: string;
  visibility: 'PRIVATE' | 'UNLISTED' | 'PUBLIC';
  publicAccessNeedsConfirmation?: boolean;
}) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<
    'revoke' | 'delete' | 'visibility' | 'rotate-link' | null
  >(null);
  const [copied, setCopied] = useState(false);
  const [nextVisibility, setNextVisibility] = useState(visibility);
  async function act() {
    if (!confirm) return;
    setBusy(true);
    setError('');
    try {
      await api(
        `/api/publications/${id}`,
        {
          revision,
          action: confirm,
          ...(confirm === 'visibility' ? { visibility: nextVisibility } : {}),
        },
        'PATCH',
      );
      location.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div>
      {confirm ? (
        <>
          <p className="fine">
            {confirm === 'delete'
              ? 'De online rapportinhoud definitief verwijderen? Je lokale audit blijft bestaan.'
              : confirm === 'rotate-link'
                ? 'De oude verborgen link wordt ongeldig. Ontvangers hebben daarna de nieuwe link nodig.'
                : confirm === 'visibility'
                  ? `Zichtbaarheid wijzigen naar ${nextVisibility === 'PRIVATE' ? 'privé' : nextVisibility === 'PUBLIC' ? 'openbaar in de index' : 'alleen via een link'}? Bestaande verborgen links vervallen. Eerder gedownloade kopieën blijven bij de ontvanger.`
                  : 'Dit rapport intrekken? De bestaande link geeft daarna geen toegang meer. Eerder gedownloade kopieën kunnen niet worden teruggehaald.'}
          </p>
          <div className="actions">
            <button
              className="button danger small"
              onClick={act}
              disabled={busy || !hydrated}
            >
              {confirm === 'delete'
                ? 'Verwijder online'
                : confirm === 'revoke'
                  ? 'Trek in'
                  : 'Bevestig wijziging'}
            </button>
            <button
              className="button outline small"
              disabled={busy || !hydrated}
              onClick={() => setConfirm(null)}
            >
              Annuleren
            </button>
          </div>
        </>
      ) : (
        <div className="actions">
          {active && (
            <>
              <label className="sr-only" htmlFor={`visibility-${id}`}>
                Zichtbaarheid rapport {id}
              </label>
              <select
                id={`visibility-${id}`}
                value={nextVisibility}
                disabled={busy || !hydrated}
                onChange={(event) =>
                  setNextVisibility(event.target.value as typeof visibility)
                }
                style={{ width: 'auto', maxWidth: '100%' }}
              >
                <option value="PRIVATE">Privé</option>
                <option value="UNLISTED">Via een link</option>
                <option value="PUBLIC">Openbaar</option>
              </select>
              {(nextVisibility !== visibility ||
                publicAccessNeedsConfirmation) && (
                <button
                  className="button outline small"
                  onClick={() => setConfirm('visibility')}
                  disabled={!hydrated}
                >
                  {publicAccessNeedsConfirmation &&
                  nextVisibility === visibility
                    ? 'Openbare toegang bevestigen'
                    : 'Zichtbaarheid wijzigen'}
                </button>
              )}
              {visibility === 'UNLISTED' && (
                <button
                  className="button outline small"
                  disabled={!hydrated}
                  onClick={() => setConfirm('rotate-link')}
                >
                  Deellink vervangen
                </button>
              )}
            </>
          )}
          {shareUrl && active && (
            <button
              className="button outline small"
              disabled={!hydrated}
              onClick={() =>
                navigator.clipboard
                  .writeText(new URL(shareUrl, location.origin).href)
                  .then(() => setCopied(true))
                  .catch(() =>
                    setError(
                      'Kopiëren is niet beschikbaar. Open het rapport en kopieer de link.',
                    ),
                  )
              }
            >
              {copied ? 'Link gekopieerd' : 'Kopieer deellink'}
            </button>
          )}
          {active && (
            <button
              className="button outline small"
              disabled={!hydrated}
              onClick={() => setConfirm('revoke')}
            >
              Intrekken
            </button>
          )}
          <button
            className="text-button"
            disabled={!hydrated}
            onClick={() => setConfirm('delete')}
          >
            Verwijderen
          </button>
        </div>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
