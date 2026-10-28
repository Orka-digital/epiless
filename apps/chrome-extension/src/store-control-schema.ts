import { z } from 'zod';
import { DEFAULT_HISTORY_SETTINGS } from './model';
const id = z.string().min(1).max(200);
const tabId = z.number().int().nonnegative();
const mode = z.enum(['AUTONOMOUS', 'QUICK', 'EXTENDED']);
const replayOf = z.strictObject({ jobId: id, taskId: id, observationId: id });
const webUrl = z
  .string()
  .max(8192)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  });
const startSchema = z.strictObject({
  id,
  tabId,
  origin: webUrl.refine((value) => new URL(value).origin === value),
  mode,
  viewportSeconds: z.number().finite().min(15).max(120).optional(),
  replayOf: replayOf.optional(),
  advancedPointer: z.boolean().optional(),
  expiresAt: z.number().finite().nonnegative(),
});
const recheckSchema = z.strictObject({ replayOf, route: webUrl, tabId });
const preferencesSchema = z.strictObject({
  mode,
  viewportSeconds: z.number().finite().min(15).max(120),
});
const historySchema = z.strictObject({
  schemaVersion: z.literal(1),
  detailRetentionDays: z.union([
    z.literal(30),
    z.literal(90),
    z.literal(365),
    z.null(),
  ]),
});
export type StartIntent = z.infer<typeof startSchema>;
export type PendingRecheck = z.infer<typeof recheckSchema>;

/** Invalid persisted authorization data is ignored and never starts a scan or guesses a tab. */
export function readStartIntent(value: unknown): StartIntent | undefined {
  const result = startSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
/** Rechecks must retain an exact job/task/observation reference and a valid target tab. */
export function readPendingRecheck(value: unknown): PendingRecheck | undefined {
  const result = recheckSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
/** Corrupt preferences use explicit safe defaults; never pass unchecked values into capture planning. */
export function readScanPreferences(value: unknown) {
  const result = preferencesSchema.safeParse(value);
  return result.success
    ? result.data
    : { mode: 'AUTONOMOUS' as const, viewportSeconds: 30 };
}
/** Invalid retention data preserves details rather than accidentally choosing a deletion deadline. */
export function readHistorySettings(value: unknown) {
  const result = historySchema.safeParse(value);
  return result.success
    ? result.data
    : { ...DEFAULT_HISTORY_SETTINGS, detailRetentionDays: null };
}
