import { HttpError } from './types';

const internalSuffixes = [
  'localhost',
  'local',
  'localdomain',
  'internal',
  'intranet',
  'lan',
  'home',
  'corp',
  'private',
  'test',
  'invalid',
  'example',
  'arpa',
  'onion',
  'i2p',
  // Common development DNS services deliberately resolve to loopback.
  'localtest.me',
  'lvh.me',
];

function publicV4(parts: number[]): boolean {
  const [a = 0, b = 0, c = 0] = parts;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    specialV4Block(a, b, c)
  );
}

/** Conservative literal/suffix policy; never performs DNS or fetches the submitted site. */
export function isPublicOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)
    return false;
  const host = url.hostname.toLowerCase().replace(/\.$/u, '');
  if (host.startsWith('[')) {
    return publicV6(host);
  }
  if (/^\d+\.\d+\.\d+\.\d+$/u.test(host))
    return publicV4(host.split('.').map(Number));
  if (
    !host.includes('.') ||
    internalSuffixes.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    )
  )
    return false;
  // Wildcard development hosts can encode a private literal in their labels.
  if (host.endsWith('.nip.io') || host.endsWith('.sslip.io')) {
    const encoded = host.match(
      /(?:^|[.-])(\d{1,3})[.-](\d{1,3})[.-](\d{1,3})[.-](\d{1,3})(?:[.-]|$)/u,
    );
    if (encoded && !publicV4(encoded.slice(1).map(Number))) return false;
  }
  return true;
}

/** Reject nonpublic origins before accepting a publication target. */
export function assertPublicOrigin(origin: string): void {
  if (!isPublicOrigin(origin))
    throw new HttpError(
      422,
      'PUBLIC_ORIGIN_REQUIRED',
      'Deze website is lokaal, intern of gebruikt een niet-publiek adres. Bewaar het rapport privé of deel het via een link; het kan niet in de openbare index.',
    );
}

function publicV6(host: string): boolean {
  const address = host.slice(1, -1);
  const halves = address.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const words = [
    ...left,
    ...Array(8 - left.length - right.length).fill('0'),
    ...right,
  ].map((word) => Number.parseInt(word, 16));
  const [first = 0, second = 0] = words;
  // Global unicast only, excluding special/tunnel and documentation ranges.
  // This also excludes mapped IPv4, loopback, ULA, link-local and NAT64 forms.
  return (
    first >= 0x2000 &&
    first <= 0x3fff &&
    first !== 0x2002 &&
    !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8)) &&
    !(first === 0x3fff && second <= 0x0fff)
  );
}

function specialV4Block(a: number, b: number, c: number): boolean {
  return (
    (a === 192 &&
      (b === 168 ||
        (b === 0 && [0, 2].includes(c)) ||
        (b === 88 && c === 99))) ||
    (a === 198 && ([18, 19].includes(b) || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
