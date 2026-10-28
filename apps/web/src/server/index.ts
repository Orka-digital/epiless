import { env as workerEnv } from 'cloudflare:workers';
import type { RuntimeEnv } from './types';
export { getSession } from './auth';
export {
  getModerationPublication,
  getPublication,
  getSiteSummary,
  isModerator,
  listModerationQueue,
  listOwnReportPage,
  listSites,
} from './publications';
export { HttpError, type RuntimeEnv } from './types';

/** Read the configured server runtime bindings for this request. */
export function getRuntime(_context?: { locals?: unknown }): RuntimeEnv {
  // Astro 6+ deliberately throws when its removed locals.runtime getter is read.
  // Workers bindings come directly from the supported cloudflare:workers module.
  return workerEnv as unknown as RuntimeEnv;
}
