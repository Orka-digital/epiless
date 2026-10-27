declare const __SCANNER_BUILD_SHA256__: string | undefined;

/** Injected by the reproducible build. Unbundled tests and watch builds cannot
 * establish an immutable implementation identity and deliberately omit it. */
export const SCANNER_BUILD_SHA256 =
  typeof __SCANNER_BUILD_SHA256__ === 'string' &&
  /^[a-f0-9]{64}$/.test(__SCANNER_BUILD_SHA256__)
    ? __SCANNER_BUILD_SHA256__
    : undefined;
