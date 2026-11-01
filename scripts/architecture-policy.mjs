/** @typedef {import('./architecture-graph.mjs').Edge} Edge */
/** @param {string} path */
function workspace(path) {
  return path.split('/').slice(0, 2).join('/');
}
/** Enforce direction at public package, application and browser/server trust boundaries.
 * Type imports can share contracts across layers, but cannot bypass package exports.
 * @param {Edge} edge
 * @returns {string | undefined}
 */
export function boundaryViolation(edge) {
  const { source, target, specifier, typeOnly } = edge;
  const from = workspace(source),
    to = workspace(target);
  if (from !== to && specifier.startsWith('.'))
    return 'Cross-workspace imports must use declared package exports';
  if (source.startsWith('packages/') && target.startsWith('apps/'))
    return 'Packages cannot depend on applications';
  if (source.startsWith('apps/') && target.startsWith('apps/') && from !== to)
    return 'Applications cannot depend on each other';
  if (from === 'packages/core' && to !== from)
    return 'Core cannot depend on higher-level workspace packages';
  if (typeOnly) return;
  if (
    source.startsWith('apps/web/src/server/db/') &&
    target.startsWith('apps/web/src/server/') &&
    !target.startsWith('apps/web/src/server/db/')
  )
    return 'Database adapters cannot import application services';
  if (
    /^apps\/web\/src\/(components|lib|layouts)\//.test(source) &&
    target.startsWith('apps/web/src/server/')
  )
    return 'Client and layout modules cannot import server services';
  if (
    source.startsWith('apps/web/src/server/') &&
    /^apps\/web\/src\/(components|lib|pages)\//.test(target)
  )
    return 'Server services cannot import UI modules';
  if (
    source.startsWith('apps/chrome-extension/src/') &&
    source.endsWith('.tsx') &&
    /\/(runner[^/]*|observation-[^/]*|background|offscreen|store)\.ts$/.test(
      target,
    )
  )
    return 'Extension components must use command contracts instead of worker or storage internals';
  if (
    source.startsWith('apps/chrome-extension/src/') &&
    /\/(runner[^/]*|observation-[^/]*)\.ts$/.test(source) &&
    target.endsWith('.tsx')
  )
    return 'Scanner application logic cannot import UI components';
}
