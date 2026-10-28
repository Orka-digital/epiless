import { findingSchema, frameQualitySchema } from '@epi-less/core';
import { z } from 'zod';
import type { Measurement } from './model';

const measurementSchema = z.strictObject({
  status: z.enum(['NO_ISSUES_OBSERVED', 'NEEDS_REVIEW', 'INCONCLUSIVE']),
  passed: z.null(),
  quality: frameQualitySchema,
  findings: z.array(findingSchema),
  limitations: z.array(z.string()),
});
/** Validate the worker result before assigning it to trusted observation state.
 * Malformed results fail closed; a missing measurement must never become a clean scan.
 */
export function parseMeasurement(input: unknown): Measurement {
  const result = measurementSchema.safeParse(input);
  if (!result.success) throw new Error('INVALID_MEASUREMENT_RESULT');
  return result.data;
}

/** An open segment always owns a source. Terminal variants always carry their completion time.
 * Interruption can retain valid partial evidence, but is never represented as completed capture.
 */
export type ObservationCaptureState =
  | { state: 'unopened' }
  | { state: 'capturing'; sourceId: string }
  | { state: 'completed'; endedAt: number; measurement: Measurement }
  | {
      state: 'interrupted';
      endedAt: number;
      reason: string;
      measurement?: Measurement;
    };
