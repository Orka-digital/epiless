import { z } from 'zod';
import { sourceFrameClockSchema } from '@epi-less/core';
import type { AuditReport } from '@epi-less/core';
import type { buildHistoryExport } from './export';
import type { AppState } from './ui-state';

const id = z.string().min(1).max(200);
const tabId = z.number().int().nonnegative();
const mode = z.enum(['AUTONOMOUS', 'QUICK', 'EXTENDED']);
const replayOf = z.strictObject({ jobId: id, taskId: id, observationId: id });
const start = {
  tabId,
  mode: mode.optional(),
  viewportSeconds: z.number().finite().min(15).max(120).optional(),
  advancedPointer: z.boolean().optional(),
  replayOf: replayOf.optional(),
};
const dimension = z.number().int().positive().max(16384);
const size = z.strictObject({ width: dimension, height: dimension });
const candidate = {
  generation: id,
  segmentId: id,
  findingId: id,
  windowStartMs: z.number().finite().nonnegative(),
  windowEndMs: z.number().finite().nonnegative(),
  windowStartEpochMs: z.number().finite(),
  windowEndEpochMs: z.number().finite(),
  clockBasis: z.literal('FRAME_RECEIPT_ESTIMATE'),
  alignmentUncertaintyMs: z.number().finite().nonnegative().nullable(),
  frameClock: sourceFrameClockSchema.optional(),
  analysis: size,
  source: size,
  region: z.strictObject({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: dimension,
    height: dimension,
  }),
};
function message<T extends string, S extends z.ZodRawShape>(type: T, shape: S) {
  return z.strictObject({
    type: z.literal(type),
    target: z.literal('background').optional(),
    ...shape,
  });
}
/** One runtime boundary for UI and offscreen messages. Ownership checks still run in the handler. */
const backgroundCommandSchema = z.discriminatedUnion('type', [
  message('GET_STATE', { inspectedTabId: tabId.optional() }),
  message('PREPARE_ADVANCED_SCAN', start),
  message('PREPARE_START', start),
  message('START', start),
  message('CANCEL_ADVANCED_SCAN', { tabId }),
  message('CANCEL_START', { tabId }),
  message('CONTINUE_START', {}),
  message('CANCEL_RECHECK', {}),
  message('OPEN_DASHBOARD', {}),
  message('PREPARE_RECHECK', { replayOf }),
  message('REVIEW_ISSUE', {
    jobId: id,
    review: z.strictObject({
      taskId: id,
      observationId: id,
      findingId: id,
      decision: z.enum(['CONFIRMED', 'FALSE_POSITIVE', 'RESOLVED', 'REOPENED']),
      note: z.string().max(1000),
      verificationJobId: id.optional(),
    }),
  }),
  message('RESUME', { id }),
  message('PAUSE', { id }),
  message('STOP', { id }),
  message('OPEN_TARGET', { id }),
  message('DELETE', { id }),
  message('PUBLISH_PREVIEW', { id }),
  message('EXPORT', { id, pseudonymize: z.boolean().optional() }),
  message('EXPORT_HTML', { id, pseudonymize: z.boolean().optional() }),
  message('EXPORT_HISTORY', {
    origin: z.string().max(2048).optional(),
    pseudonymize: z.boolean().optional(),
  }),
  message('DELETE_HISTORY', { origin: z.string().max(2048).optional() }),
  message('SET_HISTORY_SETTINGS', {
    settings: z.strictObject({
      detailRetentionDays: z.union([
        z.literal(30),
        z.literal(90),
        z.literal(365),
        z.null(),
      ]),
    }),
  }),
  message('SET_SCAN_PREFERENCES', {
    mode,
    viewportSeconds: z.number().finite().min(15).max(120),
  }),
  message('CANDIDATE_EVENT', candidate),
  message('CAPTURE_HEARTBEAT', { generation: id }),
  message('CAPTURE_LOST', {
    generation: id,
    sourceId: id,
    reason: z.string().max(2000).optional(),
  }),
]);
export type BackgroundCommand = z.infer<typeof backgroundCommandSchema>;
type CommandType = BackgroundCommand['type'];
export type StartOptions = Omit<
  Extract<BackgroundCommand, { type: 'START' }>,
  'type' | 'target'
>;
type CommandPayload<K extends CommandType> = Omit<
  Extract<BackgroundCommand, { type: K }>,
  'type' | 'target'
>;
export type CommandArgs<K extends CommandType = CommandType> = {
  [T in K]: Record<string, never> extends CommandPayload<T>
    ? [type: T, values?: CommandPayload<T>]
    : [type: T, values: CommandPayload<T>];
}[K];
export type CommandAction = (...args: CommandArgs) => Promise<void>;
export type CommandResult<K extends CommandType> = K extends 'GET_STATE'
  ? AppState
  : K extends 'EXPORT'
    ? AuditReport
    : K extends 'EXPORT_HTML'
      ? string
      : K extends 'EXPORT_HISTORY'
        ? ReturnType<typeof buildHistoryExport>
        : K extends 'START' | 'RESUME'
          ? { id: string }
          : K extends 'PREPARE_ADVANCED_SCAN' | 'PREPARE_RECHECK'
            ? { tabId: number }
            : K extends 'REVIEW_ISSUE'
              ? { saved: true }
              : Record<string, never>;

/** Validate untrusted extension messages and bounded candidate geometry before dispatch. */
export function parseBackgroundCommand(input: unknown): BackgroundCommand {
  const result = backgroundCommandSchema.safeParse(input);
  if (!result.success)
    throw new Error(
      'Ongeldig extensiebericht: controleer de opdracht en velden.',
    );
  const value = result.data;
  if (
    value.type === 'CANDIDATE_EVENT' &&
    (value.windowEndMs < value.windowStartMs ||
      value.windowEndEpochMs < value.windowStartEpochMs ||
      value.region.x + value.region.width > value.analysis.width ||
      value.region.y + value.region.height > value.analysis.height)
  )
    throw new Error('Ongeldig meetvenster of pixelgebied.');
  return value;
}
