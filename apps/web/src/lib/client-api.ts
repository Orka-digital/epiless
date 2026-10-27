export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryAfterMs = 0,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export async function api<T = Record<string, unknown>>(
  path: string,
  body?: unknown,
  method = 'POST',
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    signal: AbortSignal.timeout(20_000),
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await response.json().catch(() => null)) as {
    error?: { message?: string; code?: string };
    message?: string;
  } | null;
  if (!response.ok) {
    const retry = response.headers.get('Retry-After');
    const retryAfterMs = retry
      ? /^\d+$/u.test(retry)
        ? Number(retry) * 1000
        : Math.max(0, Date.parse(retry) - Date.now()) || 0
      : 0;
    throw new ApiError(
      data?.error?.message ||
        data?.message ||
        (response.status === 429
          ? 'Te veel verzoeken. Wacht een minuut voordat je opnieuw probeert.'
          : 'Deze handeling is niet gelukt. Probeer later opnieuw.'),
      response.status,
      data?.error?.code,
      retryAfterMs,
    );
  }
  return data as T;
}
export interface ChallengeData {
  id: string;
  action: string;
  cdata: string;
  siteKey: string;
  local: boolean;
}
