import { planRoute } from '@epi-less/core';

const MAX_DOCUMENT_BYTES = 256 * 1024;
const MAX_DOCUMENTS = 3;
const MAX_CANDIDATES = 500;
const decodeXml = (value: string) =>
  value.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (whole, entity: string) => {
      if (entity[0] === '#') {
        const number =
          entity[1].toLowerCase() === 'x'
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10);
        return number > 0 && number <= 0x10ffff
          ? String.fromCodePoint(number)
          : whole;
      }
      return (
        { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[
          entity.toLowerCase() as 'amp'
        ] ?? whole
      );
    },
  );

export function parseSitemap(xml: string): {
  kind: 'index' | 'urls';
  urls: string[];
} {
  if (new TextEncoder().encode(xml).length > MAX_DOCUMENT_BYTES)
    throw new Error('SITEMAP_DOCUMENT_LIMIT');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error('SITEMAP_UNSUPPORTED_XML');
  const index = /<(?:[\w.-]+:)?sitemapindex(?:\s|>)/i.test(xml);
  if (!index && !/<(?:[\w.-]+:)?urlset(?:\s|>)/i.test(xml))
    throw new Error('SITEMAP_UNSUPPORTED_XML');
  const urls: string[] = [];
  for (const match of xml.matchAll(
    /<(?:[\w.-]+:)?loc(?:\s[^>]*)?>([^<]{1,8192})<\/(?:[\w.-]+:)?loc\s*>/gi,
  )) {
    if (urls.length >= MAX_CANDIDATES)
      throw new Error('SITEMAP_CANDIDATE_LIMIT');
    urls.push(decodeXml(match[1].trim()));
  }
  return { kind: index ? 'index' : 'urls', urls };
}

type RobotGroup = {
  agents: string[];
  rules: { allow: boolean; path: string }[];
};
function robotGroups(text: string): RobotGroup[] {
  const groups: RobotGroup[] = [];
  let current: RobotGroup | undefined;
  let hasRules = false;
  for (const line of text.split(/\r?\n/)) {
    const clean = line.replace(/#.*/, '').trim();
    const colon = clean.indexOf(':');
    if (colon < 0) continue;
    const field = clean.slice(0, colon).trim().toLowerCase();
    const value = clean.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (!current || hasRules) {
        current = { agents: [], rules: [] };
        groups.push(current);
        hasRules = false;
      }
      current.agents.push(value.toLowerCase());
    } else if ((field === 'allow' || field === 'disallow') && current) {
      hasRules = true;
      if (value) current.rules.push({ allow: field === 'allow', path: value });
    }
  }
  return groups;
}
export function robotsAllows(url: string, text: string): boolean {
  const groups = robotGroups(text);
  const named = groups.filter((group) => group.agents.includes('flashguard'));
  const selected = named.length
    ? named
    : groups.filter((group) => group.agents.includes('*'));
  const normalizePath = (value: string) =>
    value
      .replace(/[^\x00-\x7F]/gu, (character) => encodeURIComponent(character))
      .replace(/%([\da-f]{2})/gi, (_, hex: string) => {
        const character = String.fromCharCode(Number.parseInt(hex, 16));
        // Decode only unreserved octets. Encoded *, / and $ remain literals,
        // so an encoded Allow pattern cannot gain wildcard semantics.
        return /[a-z\d._~-]/i.test(character)
          ? character
          : `%${hex.toUpperCase()}`;
      });
  const path = normalizePath(new URL(url).pathname);
  const rules = selected
    .flatMap((group) => group.rules)
    .map((rule) => ({ ...rule, path: normalizePath(rule.path) }));
  // Do not compile site-controlled wildcard patterns to backtracking regexes.
  // Unsupported complexity declines sitemap exploration, never broadens permission.
  if (rules.length > 128 || rules.some((rule) => rule.path.length > 512))
    return false;
  let steps = 0;
  const matches = (pattern: string): boolean | undefined => {
    const end = pattern.endsWith('$');
    if (end) pattern = pattern.slice(0, -1);
    let input = 0;
    let cursor = 0;
    let star = -1;
    let retry = 0;
    while (input < path.length) {
      if (++steps > 16_384) return undefined;
      if (cursor === pattern.length && !end) return true;
      if (pattern[cursor] === path[input]) {
        cursor++;
        input++;
      } else if (pattern[cursor] === '*') {
        star = cursor++;
        retry = input;
      } else if (star !== -1) {
        cursor = star + 1;
        input = ++retry;
      } else return false;
    }
    while (pattern[cursor] === '*') cursor++;
    return cursor === pattern.length;
  };
  const matching = [];
  for (const rule of rules) {
    const match = matches(rule.path);
    if (match === undefined) return false;
    if (match) matching.push(rule);
  }
  matching.sort(
    (a, b) =>
      b.path.replace(/[*$]/g, '').length - a.path.replace(/[*$]/g, '').length ||
      Number(b.allow) - Number(a.allow),
  );
  return matching[0]?.allow ?? true;
}

async function readDocument(
  url: string,
  fetcher: typeof fetch,
): Promise<string | undefined> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 4000);
  try {
    const response = await fetcher(url, {
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: abort.signal,
    });
    if (response.status === 404 || response.status === 410) return undefined;
    if (!response.ok || !response.body) throw new Error('SITEMAP_UNAVAILABLE');
    if (
      Number(response.headers.get('content-length') ?? 0) > MAX_DOCUMENT_BYTES
    )
      throw new Error('SITEMAP_DOCUMENT_LIMIT');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let result = '';
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_DOCUMENT_BYTES)
          throw new Error('SITEMAP_DOCUMENT_LIMIT');
        result += decoder.decode(chunk.value, { stream: true });
      }
      return result + decoder.decode();
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/** No redirects, cookies, cross-origin fetches, unbounded XML or credentials. Candidate discovery is not coverage. */
export async function discoverSitemap(
  origin: string,
  guard: () => Promise<unknown>,
  fetcher: typeof fetch = fetch,
): Promise<{ urls: string[]; limitations: string[] }> {
  const urls: string[] = [];
  const limitations: string[] = [];
  await guard();
  let robots: string;
  try {
    robots = (await readDocument(`${origin}/robots.txt`, fetcher)) ?? '';
  } catch {
    return {
      urls,
      limitations: [
        'SITEMAP_DISCOVERY_UNAVAILABLE: robots.txt could not be checked.',
      ],
    };
  }
  const declared = [...robots.matchAll(/^sitemap:\s*(\S+)\s*$/gim)]
    .slice(0, MAX_DOCUMENTS)
    .map((match) => match[1]);
  const queue = declared.length ? declared : [`${origin}/sitemap.xml`];
  const seen = new Set<string>();
  while (queue.length && seen.size < MAX_DOCUMENTS) {
    await guard();
    const candidate = queue.shift()!;
    const decision = planRoute({
      candidate,
      baseUrl: origin,
      origin,
      depth: 0,
    });
    if (
      !decision.allowed ||
      !decision.url ||
      seen.has(decision.url) ||
      !robotsAllows(decision.url, robots)
    )
      continue;
    seen.add(decision.url);
    try {
      const xml = await readDocument(decision.url, fetcher);
      if (xml === undefined) continue;
      const sitemap = parseSitemap(xml);
      for (const entry of sitemap.urls) {
        const route = planRoute({
          candidate: entry,
          baseUrl: decision.url,
          origin,
          depth: 0,
        });
        if (!route.allowed || !route.url || !robotsAllows(route.url, robots))
          continue;
        if (sitemap.kind === 'index') queue.push(route.url);
        else if (!urls.includes(route.url)) {
          if (urls.length >= MAX_CANDIDATES) {
            limitations.push('SITEMAP_CANDIDATE_LIMIT');
            break;
          }
          urls.push(route.url);
        }
      }
    } catch (error) {
      limitations.push(
        error instanceof Error
          ? error.message
          : 'SITEMAP_DISCOVERY_UNAVAILABLE',
      );
    }
  }
  await guard();
  if (queue.length) limitations.push('SITEMAP_DOCUMENT_LIMIT');
  return { urls, limitations: [...new Set(limitations)] };
}
