const PREVIEW_PATH = '/social/epi-less-preview-v1.png';

function configuredOrigin(value?: string): URL | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.origin !== value ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  )
    throw new Error(
      'Social previews require a canonical HTTPS or local development origin.',
    );
  return url;
}

/** Use configured origins only; never a request URL, report origin or share token. */
export function socialImageUrl(
  siteOrigin?: string,
  runtimeOrigin?: string,
): string {
  const site = configuredOrigin(siteOrigin);
  const runtime = configuredOrigin(runtimeOrigin);
  // The build's canonical HTTPS site also works during prerendering, where
  // Wrangler can still expose local bindings. Local builds use their configured
  // Worker port instead of Astro's default localhost:4321.
  const origin = site?.protocol === 'https:' ? site : runtime || site;
  if (!origin)
    throw new Error('Configure the epi-less site origin before building.');
  return new URL(PREVIEW_PATH, origin).href;
}

/** Format known timestamps for display with an explicit unavailable fallback. */
export function timestampLabel(value: string): string {
  return new Intl.DateTimeFormat('nl-BE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
    timeZone: 'Europe/Brussels',
  }).format(new Date(value));
}
