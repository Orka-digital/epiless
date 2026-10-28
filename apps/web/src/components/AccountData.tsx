import { useHydrated } from '../lib/use-hydrated';
import { useState, type SubmitEvent } from 'react';
import { api } from '../lib/client-api';

export default function AccountData({ accountId }: { accountId: string }) {
  const [action, setAction] = useState<'export' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const hydrated = useHydrated();
  const [message, setMessage] = useState('');
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setMessage('');
    try {
      const result = await api(`/api/account/${action}`, {
        expectedAccountId: accountId,
        password: data.get('password'),
        confirmation: data.get('confirmation'),
      });
      form.reset();
      if (action === 'delete') {
        try {
          const { clearAccountUploads } = await import('../lib/upload-queue');
          await clearAccountUploads(accountId);
          location.assign('/account?deleted=1');
        } catch {
          location.assign('/account?deleted=1&localCleanup=failed');
        }
        return;
      }
      const blob = new Blob([JSON.stringify(result, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'epi-less-account.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setAction(null);
      setMessage(
        'Je accountgegevens zijn geëxporteerd. Bewaar dit bestand zorgvuldig: het bevat je privérapporten.',
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="account-data"
      aria-labelledby="account-data-title"
      style={{
        marginTop: 32,
        paddingTop: 24,
        borderTop: '1px solid var(--line)',
      }}
    >
      <h2 id="account-data-title">Accountgegevens</h2>
      <p className="fine">
        Download je profiel en online rapporten, of verwijder je account en alle
        online inhoud. Lokale audits in de extensie blijven bewaard.
      </p>
      {!action ? (
        <div className="actions">
          <button
            className="button outline small"
            disabled={!hydrated}
            onClick={() => {
              setAction('export');
              setMessage('');
            }}
          >
            Account exporteren
          </button>
          <button
            className="text-button"
            disabled={!hydrated}
            onClick={() => {
              setAction('delete');
              setMessage('');
            }}
          >
            Account verwijderen
          </button>
        </div>
      ) : (
        <form
          onSubmit={(event) => void submit(event)}
          style={{ maxWidth: 480, marginTop: 16 }}
        >
          {action === 'delete' && (
            <p className="notice">
              Alle online rapporten, deellinks, uploads en sessies worden
              definitief verwijderd. Eerder gedownloade kopieën bij ontvangers
              kunnen niet worden teruggehaald. Alleen minimale verwijdercodes
              blijven bewaard om herstel uit backups veilig te laten verlopen.
            </p>
          )}
          <label htmlFor="account-password">Huidig wachtwoord</label>
          <input
            id="account-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
            disabled={busy}
          />
          {action === 'delete' && (
            <>
              <label htmlFor="account-delete-confirmation">
                Typ VERWIJDER ter bevestiging
              </label>
              <input
                id="account-delete-confirmation"
                name="confirmation"
                required
                pattern="VERWIJDER"
                autoComplete="off"
                disabled={busy}
              />
            </>
          )}
          <div className="actions">
            <button
              className={`button small ${action === 'delete' ? 'danger' : ''}`}
              disabled={busy}
            >
              {busy
                ? 'Bezig…'
                : action === 'delete'
                  ? 'Verwijder account definitief'
                  : 'Download accountgegevens'}
            </button>
            <button
              type="button"
              className="button outline small"
              disabled={busy}
              onClick={() => {
                setAction(null);
                setMessage('');
              }}
            >
              Annuleren
            </button>
          </div>
        </form>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
