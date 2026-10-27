const origin = new URL(process.env.PUBLIC_APP_ORIGIN ?? '');
if (origin.protocol !== 'https:')
  throw new Error('A public HTTPS deployment origin is required');
for (const path of ['/', '/sites', '/api/index']) {
  const response = await fetch(new URL(path, origin), {
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`Deployment probe ${path} returned ${response.status}`);
  if (path.startsWith('/api/')) {
    if (!response.headers.get('cache-control')?.includes('no-store'))
      throw new Error('Dynamic report/index API must not be cached');
    const body = await response.json();
    if (!Array.isArray(body.items))
      throw new Error('Public index response does not match its contract');
  }
}
console.log(
  'Public page and read-only D1 index probes passed. Account, Turnstile, publication and revocation still require the production acceptance flow.',
);
