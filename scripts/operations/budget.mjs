/** Caller supplies measurements and their matching limit units; no invented provider costs. */
/**
 * @param {{metrics: {name:string,used:number,limit:number,unit:string}[]}} input
 */
export function assessBudget(input) {
  if (!Array.isArray(input?.metrics) || !input.metrics.length)
    throw new Error('Provide measured usage metrics and limits.');
  return input.metrics.map(({ name, used, limit, unit }) => {
    if (
      typeof name !== 'string' ||
      !name ||
      typeof unit !== 'string' ||
      !Number.isFinite(used) ||
      used < 0 ||
      !Number.isFinite(limit) ||
      limit <= 0
    )
      throw new Error('Invalid measured budget metric.');
    const percentage = (used / limit) * 100;
    return {
      name,
      used,
      limit,
      unit,
      percentage: Math.round(percentage * 10) / 10,
      level:
        percentage >= 95
          ? 'critical'
          : percentage >= 80
            ? 'warning'
            : percentage >= 50
              ? 'notice'
              : 'normal',
    };
  });
}
