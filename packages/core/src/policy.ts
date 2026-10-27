const forbiddenAction =
  /(?:^|[\s/_?&=.#:;+\-])(log[\s_-]?out|sign[\s_-]?out|log[\s_-]?in|sign[\s_-]?in|sign[\s_-]?up|register|authorize|authorise|oauth|permissions?|grant|allow|install|connect|delete|remove|unsubscribe|checkout|basket|cart|purchase|buy|payment|pay|downloads?|export|submit|send|confirm|revoke|destroy|disconnect|reset|cancel|inloggen|aanmelden|toestaan|uitloggen|verwijderen|betalen|bestellen|versturen)(?:$|[\s/_?&=.#:;+\-])/i;
const secretKey =
  /token|key|auth|session|email|code|password|secret|signature|credential/i;

function hasTransactionMarker(value: string): boolean {
  return forbiddenAction.test(value.replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
}

/** Removes URL credentials, query and fragment. Paths still require human review before sharing. */
export function normalizePublicUrl(input: string): string {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new TypeError('Only HTTP(S) URLs are supported');
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.href;
}

export interface RoutePolicyInput {
  candidate: string;
  baseUrl: string;
  origin: string;
  depth: number;
  visited?: ReadonlySet<string> | readonly string[];
  maxDepth?: number;
  allowedQueryKeys?: readonly string[];
}
export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  url?: string;
}

export function planRoute(input: RoutePolicyInput): PolicyDecision {
  try {
    if (
      !Number.isInteger(input.depth) ||
      input.depth < 0 ||
      input.depth > (input.maxDepth ?? 4)
    ) {
      return { allowed: false, reason: 'DEPTH_LIMIT' };
    }
    const url = new URL(input.candidate, input.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol))
      return { allowed: false, reason: 'UNSUPPORTED_SCHEME' };
    if (url.origin !== new URL(input.origin).origin)
      return { allowed: false, reason: 'OUTSIDE_ORIGIN' };
    if (url.username || url.password)
      return { allowed: false, reason: 'URL_CREDENTIALS' };
    let decoded = url.pathname;
    for (let i = 0; i < 2; i++) decoded = decodeURIComponent(decoded);
    if (hasTransactionMarker(decoded))
      return { allowed: false, reason: 'POTENTIAL_TRANSACTION' };
    for (const [key, value] of url.searchParams) {
      if (secretKey.test(key) || hasTransactionMarker(value))
        return { allowed: false, reason: 'SENSITIVE_QUERY' };
      if (!input.allowedQueryKeys?.includes(key))
        return { allowed: false, reason: 'QUERY_NOT_ALLOWED' };
    }
    url.searchParams.sort();
    url.hash = '';
    const normalized = url.href;
    const visited =
      input.visited instanceof Set
        ? input.visited
        : new Set(input.visited ?? []);
    if (visited.has(normalized))
      return { allowed: false, reason: 'ALREADY_VISITED' };
    return { allowed: true, reason: 'IN_SCOPE', url: normalized };
  } catch {
    return { allowed: false, reason: 'INVALID_URL' };
  }
}

export interface InspectionAction {
  kind:
    | 'scroll'
    | 'menu'
    | 'accordion'
    | 'tab'
    | 'carousel'
    | 'media'
    | 'consent-reject'
    | 'link'
    | 'unknown';
  role?: string;
  type?: string;
  href?: string;
  text?: string;
  ariaControls?: string;
  ariaExpanded?: boolean;
  inForm?: boolean;
  download?: boolean;
}

/** A conservative inspection allowlist. Navigation still requires planRoute(). */
export function evaluateAction(action: InspectionAction): PolicyDecision {
  if (
    action.download ||
    action.inForm ||
    ['submit', 'reset', 'image'].includes(action.type?.toLowerCase() ?? '') ||
    hasTransactionMarker(`${action.text ?? ''} ${action.ariaControls ?? ''}`) ||
    /\b(post|upload)\b/i.test(action.text ?? '')
  ) {
    return { allowed: false, reason: 'POTENTIAL_TRANSACTION' };
  }
  if (action.kind === 'link')
    return { allowed: false, reason: 'NAVIGATION_REQUIRES_ROUTE_POLICY' };
  if (action.href)
    return { allowed: false, reason: 'NAVIGATION_REQUIRES_ROUTE_POLICY' };
  if (action.kind === 'scroll' || action.kind === 'media')
    return { allowed: true, reason: 'SUPPORTED_INSPECTION' };
  if (
    ['menu', 'accordion'].includes(action.kind) &&
    action.ariaControls &&
    typeof action.ariaExpanded === 'boolean'
  ) {
    return { allowed: true, reason: 'SUPPORTED_DISCLOSURE' };
  }
  if (action.kind === 'tab' && action.role === 'tab' && action.ariaControls)
    return { allowed: true, reason: 'SUPPORTED_TAB' };
  if (
    action.kind === 'carousel' &&
    action.role === 'button' &&
    action.ariaControls &&
    /^(next|previous|volgende|vorige)( slide| dia)?$/i.test(
      action.text?.trim() ?? '',
    )
  ) {
    return { allowed: true, reason: 'SUPPORTED_CAROUSEL' };
  }
  // Only callers which have identified a supported consent component may use this kind.
  if (
    action.kind === 'consent-reject' &&
    action.role === 'button' &&
    /^(reject all|reject optional|alle weigeren|alles weigeren|alleen noodzakelijk)$/i.test(
      action.text?.trim() ?? '',
    )
  ) {
    return { allowed: true, reason: 'SUPPORTED_CONSENT_REJECTION' };
  }
  return { allowed: false, reason: 'UNSUPPORTED_CONTROL' };
}
