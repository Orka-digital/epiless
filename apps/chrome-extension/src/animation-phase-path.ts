export const samePath = (a: readonly string[], b: readonly string[]) =>
  JSON.stringify(a) === JSON.stringify(b);
