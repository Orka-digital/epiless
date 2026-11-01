/** Read the same quality counter from current or frozen internal layouts.
 * Differential assertions stay exact; only the structural location changed.
 * @param {import('./probe-types.js').AnalyzerProbe} analyzer
 * @param {'frameIndex'|'representativeCount'|'tilesPrepared'|'invalid'|'interrupted'|'count'|'first'|'last'|'gap'} key
 */
export function readQualityField(analyzer, key) {
  if (
    key === 'frameIndex' ||
    key === 'representativeCount' ||
    key === 'tilesPrepared'
  )
    return analyzer[key];
  return analyzer.quality?.[key] ?? analyzer[key];
}
