/** Compare persisted JSON meaning, including additional fields, without relying
 * on object key order. Non-JSON values cannot establish ownership. */
export function matchingRecord(a: unknown, b: unknown): boolean {
  const seenLeft = new Set<object>(),
    seenRight = new Set<object>();
  const same = (left: unknown, right: unknown): boolean => {
    if (typeof left !== typeof right) return false;
    if (typeof left === 'number')
      return Number.isFinite(left) && left === right;
    if (left === null || right === null) return left === right;
    if (typeof left !== 'object')
      return (
        ['undefined', 'string', 'boolean'].includes(typeof left) &&
        left === right
      );
    if (seenLeft.has(left) || seenRight.has(right as object)) return false;
    seenLeft.add(left);
    seenRight.add(right as object);
    try {
      if (Array.isArray(left) || Array.isArray(right)) {
        return (
          Array.isArray(left) &&
          Array.isArray(right) &&
          left.length === right.length &&
          left.every(
            (item, index) => item !== undefined && same(item, right[index]),
          )
        );
      }
      const plain = (value: object) =>
        [Object.prototype, null].includes(Object.getPrototypeOf(value));
      if (!plain(left) || !plain(right as object)) return false;
      const first = left as Record<string, unknown>,
        second = right as Record<string, unknown>;
      const keys = Object.keys(first)
        .filter((key) => first[key] !== undefined)
        .sort();
      const other = Object.keys(second)
        .filter((key) => second[key] !== undefined)
        .sort();
      return (
        keys.length === other.length &&
        keys.every(
          (key, index) => key === other[index] && same(first[key], second[key]),
        )
      );
    } finally {
      seenLeft.delete(left);
      seenRight.delete(right as object);
    }
  };
  return same(a, b);
}
