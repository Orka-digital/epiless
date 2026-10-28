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

/** Evaluate the applicable robots policy for a path; route policy is checked separately. */
export function robotsAllows(url: string, text: string): boolean {
  const groups = robotGroups(text);
  const named = groups.filter((group) => group.agents.includes('flashguard'));
  const selected = named.length
    ? named
    : groups.filter((group) => group.agents.includes('*'));
  const normalizePath = (value: string) =>
    value
      // Encode only non-ASCII characters; the explicit ASCII range is intentional.
      // eslint-disable-next-line no-control-regex
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
