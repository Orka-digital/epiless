/** Fetch pinned corpus bytes or fail before decoding or computing metrics.
 * @param {Map<string, Buffer>} files
 * @param {string} path
 * @returns {Buffer}
 */
export function requiredFile(files, path) {
  const bytes = files.get(path);
  if (!bytes) throw new Error(`Missing pinned reference bytes: ${path}`);
  return bytes;
}
