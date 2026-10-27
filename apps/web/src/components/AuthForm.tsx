import { useEffect, useRef, useState } from 'react';
import { api, type ChallengeData } from '../lib/client-api';
import Challenge from './Challenge';
function safeReturnTo(value: string) {
  try {
    const url = new URL(value, location.origin);
    return url.origin === location.origin && url.pathname.startsWith('/')
      ? url.pathname + url.search
      : '/account';
  } catch {
    return '/account';
  }
}
export default function AuthForm({
  returnTo = '/account',
}: {
  returnTo?: string;
}) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [mode, setMode] = useState<'sign-in' | 'sign-up' | 'reset'>('sign-in');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [challenge, setChallenge] = useState<ChallengeData | null>(null);
  const pending = useRef<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null);
  const fail = (message: string) => {
    setError(message);
    setBusy(false);
    setChallenge(null);
  };
  async function submit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    const data = new FormData(e.currentTarget);
    pending.current = {
      email: String(data.get('email')),
      password: String(data.get('password') || ''),
      name: String(data.get('name') || ''),
    };
    try {
      setChallenge(
        await api<ChallengeData>('/api/security/challenge', { action: 'auth' }),
      );
    } catch (e) {
      fail((e as Error).message);
    }
  }
  async function complete(token: string) {
    if (!challenge) return;
    try {
      const path =
        mode === 'reset'
          ? '/api/auth/request-password-reset'
          : `/api/auth/${mode}/email`;
      const input =
        mode === 'reset'
          ? {
              email: pending.current.email,
              redirectTo: `${location.origin}/account/reset`,
            }
          : { ...pending.current, callbackURL: `${location.origin}/account` };
      await api(path, input, 'POST', {
        'x-flashguard-challenge': challenge.id,
        'x-captcha-response': token,
      });
      if (mode === 'reset') {
        setNotice(
          'Als dit account bestaat, ontvang je een herstellink. In de lokale ontwikkelomgeving wordt geen e-mail verstuurd.',
        );
        setBusy(false);
        setChallenge(null);
      } else {
        const session = await api<{ user?: unknown } | null>(
          '/api/auth/get-session',
          undefined,
          'GET',
        );
        if (session?.user) location.assign(safeReturnTo(returnTo));
        else {
          setNotice(
            'Controleer je e-mail om je account te bevestigen. Daarna kun je aanmelden.',
          );
          setBusy(false);
          setChallenge(null);
        }
      }
    } catch (e) {
      fail((e as Error).message);
    }
  }
  return (
    <div className="form-panel">
      <div className="switch-form">
        <button
          type="button"
          disabled={busy || !hydrated}
          aria-pressed={mode === 'sign-in'}
          onClick={() => {
            setMode('sign-in');
            setError('');
          }}
        >
          Aanmelden
        </button>
        <button
          type="button"
          disabled={busy || !hydrated}
          aria-pressed={mode === 'sign-up'}
          onClick={() => {
            setMode('sign-up');
            setError('');
          }}
        >
          Account maken
        </button>
      </div>
      <form ref={form} onSubmit={submit} method="post">
        <fieldset className="form-fields" disabled={!hydrated || busy}>
          <legend className="sr-only">Accountgegevens</legend>
          {mode === 'sign-up' && (
            <label className="field">
              Openbare naam
              <input
                name="name"
                autoComplete="nickname"
                minLength={2}
                maxLength={60}
                required
              />
              <small>Deze naam staat bij je gedeelde rapporten.</small>
            </label>
          )}
          <label className="field">
            E-mailadres
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
            />
          </label>
          {mode !== 'reset' && (
            <label className="field">
              Wachtwoord
              <input
                name="password"
                type="password"
                autoComplete={
                  mode === 'sign-up' ? 'new-password' : 'current-password'
                }
                minLength={mode === 'sign-up' ? 12 : 1}
                maxLength={128}
                required
              />
              {mode === 'sign-up' && <small>Minimaal 12 tekens.</small>}
            </label>
          )}
          <button className="button" disabled={busy || !hydrated} type="submit">
            {busy
              ? 'Even controleren…'
              : mode === 'sign-up'
                ? 'Maak mijn account'
                : mode === 'reset'
                  ? 'Stuur een herstellink'
                  : 'Aanmelden'}{' '}
            <span aria-hidden="true">→</span>
          </button>
        </fieldset>
        {challenge && (
          <Challenge challenge={challenge} onToken={complete} onError={fail} />
        )}
        <div aria-live="polite">
          {error && <p className="notice error">{error}</p>}
          {notice && <p className="notice success">{notice}</p>}
        </div>
      </form>
      {mode === 'sign-in' && (
        <p className="fine">
          <button
            className="text-button"
            disabled={busy || !hydrated}
            onClick={() => setMode('reset')}
          >
            Wachtwoord vergeten?
          </button>
        </p>
      )}
      <p className="fine">
        Een account is alleen nodig voor online bewaren en beheer.{' '}
        <a href="/privacy">Zo gaan we met je gegevens om.</a>
      </p>
    </div>
  );
}
