import { useEffect, useRef, useState } from 'react';
import type { ChallengeData } from '../lib/client-api';
interface Turnstile {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
let loading: Promise<Turnstile> | undefined;
function load(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return (loading ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src =
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () =>
      window.turnstile
        ? resolve(window.turnstile)
        : reject(new Error('Verificatie kon niet starten.'));
    script.onerror = () => {
      loading = undefined;
      reject(
        new Error(
          'Cloudflare-verificatie kon niet laden. Controleer je verbinding en probeer opnieuw.',
        ),
      );
    };
    document.head.appendChild(script);
  }));
}
export default function Challenge({
  challenge,
  onToken,
  onError,
}: {
  challenge: ChallengeData;
  onToken: (token: string) => void;
  onError: (error: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onToken, onError });
  callbacks.current = { onToken, onError };
  const [status, setStatus] = useState('Verificatie voorbereiden…');
  useEffect(() => {
    let cancelled = false;
    let widget: string | undefined;
    if (challenge.local) {
      setStatus(
        'Lokale testverificatie. Er wordt geen externe challenge uitgevoerd.',
      );
      queueMicrotask(() => {
        if (!cancelled) callbacks.current.onToken('flashguard-local-test');
      });
      return () => {
        cancelled = true;
      };
    }
    load()
      .then((service) => {
        if (cancelled || !container.current) return;
        setStatus('Controle tegen geautomatiseerd misbruik.');
        widget = service.render(container.current, {
          sitekey: challenge.siteKey,
          action: challenge.action,
          cData: challenge.cdata,
          appearance: 'interaction-only',
          theme: 'light',
          callback: (token: string) => callbacks.current.onToken(token),
          'error-callback': () => {
            callbacks.current.onError('Verificatie mislukt. Probeer opnieuw.');
            return true;
          },
          'expired-callback': () =>
            callbacks.current.onError('Verificatie verlopen. Probeer opnieuw.'),
        });
      })
      .catch((e) => {
        if (!cancelled) callbacks.current.onError(e.message);
      });
    return () => {
      cancelled = true;
      if (widget) window.turnstile?.remove(widget);
    };
  }, [challenge.id]);
  return (
    <div className="verification">
      <p className="fine" role="status">
        {status}
      </p>
      <div ref={container} />
    </div>
  );
}
