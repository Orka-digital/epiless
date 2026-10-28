import { useState } from 'react';
import { api, type ChallengeData } from '../lib/client-api';
import { useHydrated } from '../lib/use-hydrated';
import Challenge from './Challenge';
/** Submit an explicit abuse report with challenge verification and visible errors. */
export default function AbuseForm({
  id,
  accessToken,
}: {
  id: string;
  accessToken?: string;
}) {
  const hydrated = useHydrated();
  const [category, setCategory] = useState('privacy');
  const [reason, setReason] = useState('');
  const [challenge, setChallenge] = useState<ChallengeData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const fail = (message: string) => {
    setError(message);
    setBusy(false);
    setChallenge(null);
  };
  async function submit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setChallenge(
        await api<ChallengeData>('/api/security/challenge', {
          action: 'abuse',
        }),
      );
    } catch (e) {
      fail((e as Error).message);
    }
  }
  async function complete(challengeToken: string) {
    if (!challenge) return;
    try {
      await api(`/api/publications/${id}/abuse`, {
        category,
        description: reason,
        challengeId: challenge.id,
        challengeToken,
        token: accessToken,
      });
      setDone(true);
    } catch (e) {
      fail((e as Error).message);
    }
  }
  if (done)
    return (
      <div className="notice success" role="status">
        Je melding is ontvangen. De inhoud wordt door beheer beoordeeld.
      </div>
    );
  return (
    <form
      className="form-panel"
      onSubmit={(event) => void submit(event)}
      method="post"
    >
      <noscript>
        <p className="notice">
          Schakel JavaScript in om de melding veilig te versturen en de
          antispamcontrole uit te voeren.
        </p>
      </noscript>
      <fieldset className="form-fields" disabled={!hydrated || busy}>
        <legend className="sr-only">Een rapportprobleem melden</legend>
        <label className="field">
          Soort probleem
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={busy}
            required
          >
            <option value="privacy">Privacy of persoonsgegevens</option>
            <option value="misleading">Misleidende of onjuiste inhoud</option>
            <option value="spam">Spam</option>
            <option value="other">Ander probleem</option>
          </select>
        </label>
        <label className="field">
          Wat klopt er niet?
          <textarea
            name="description"
            rows={5}
            minLength={10}
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            required
          />
          <small>
            Beschrijf het probleem zonder persoonsgegevens of inloggegevens te
            delen.
          </small>
        </label>
        <button className="button" disabled={busy || !id}>
          Melding versturen
        </button>
      </fieldset>
      {challenge && (
        <Challenge
          challenge={challenge}
          onToken={(token) => void complete(token)}
          onError={fail}
        />
      )}
      <p role="alert" className={error ? 'notice error' : ''}>
        {error}
      </p>
    </form>
  );
}
