import {
  sourceDiagnosticSchema,
  sourceTimelineSchema,
  type Finding,
  type SourceDiagnostic,
} from '@epi-less/core';
import type {
  DiagnosticContext,
  DiagnosticRequest,
} from './source-diagnostics';

export const SOURCE_DIAGNOSTIC_LIMIT = 8;
const TOTAL_BUDGET_MS = 5_000;
const REQUEST_TIMEOUT_MS = 2_000;
interface CollectionOptions {
  /** Ephemeral only: the URL and document token never enter the result. */
  expected?: DiagnosticContext;
  /** Fixed reason for navigation/interrupted measurements that cannot be mapped. */
  unavailableReason?: string;
  /** Background time when SEGMENT_END completed, not the flash detection time. */
  measurementEndedAt: number;
  guard: () => Promise<unknown>;
  request: (request: DiagnosticRequest, timeoutMs: number) => Promise<unknown>;
  wallClock?: () => number;
  monotonicClock?: () => number;
}

/** Untrusted content replies are validated and joined by this observation's own finding IDs. */
export function attachSourceTimelines(
  findings: Finding[],
  input: unknown,
): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  let attached = 0;
  for (const finding of findings) {
    if (attached >= SOURCE_DIAGNOSTIC_LIMIT) break;
    const value = Object.hasOwn(input, finding.id)
      ? (input as Record<string, unknown>)[finding.id]
      : undefined;
    const parsed = sourceTimelineSchema.safeParse(value);
    if (parsed.success) {
      finding.sourceTimeline = parsed.data;
      attached++;
    }
  }
}

async function timed<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('DIAGNOSTIC_TIMEOUT')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Enrich locally captured candidates without allowing optional diagnostics to
 * lose pixel evidence, interrupt capture persistence or expose page identity.
 */
export async function collectSourceDiagnostics(
  findings: Finding[],
  options: CollectionOptions,
): Promise<void> {
  const wallClock = options.wallClock ?? Date.now;
  const monotonicClock = options.monotonicClock ?? (() => performance.now());
  const started = monotonicClock();
  let attempted = 0;
  let stopped = false;
  const timing = () => {
    const timestamp = wallClock();
    return {
      sampledAt: new Date(timestamp).toISOString(),
      delayMs: Math.max(0, timestamp - options.measurementEndedAt),
    };
  };
  const unavailable = (reason: string): SourceDiagnostic => ({
    status: 'UNAVAILABLE',
    reason,
    coordinateSpace: 'CSS_VIEWPORT',
    ...timing(),
    sampledPoints: 0,
    candidates: [],
    limitations: ['POST_OBSERVATION_SPATIAL_HINT_NOT_VERIFIED_CAUSE'],
  });
  for (const finding of findings) {
    if (!finding.diagnostic || !finding.region) continue;
    if (options.unavailableReason) {
      finding.source = unavailable(options.unavailableReason);
      continue;
    }
    if (!options.expected) {
      finding.source = unavailable('SOURCE_CONTEXT_UNAVAILABLE');
      continue;
    }
    if (stopped) {
      finding.source = unavailable('SOURCE_DIAGNOSTIC_CANCELLED');
      continue;
    }
    if (attempted >= SOURCE_DIAGNOSTIC_LIMIT) {
      finding.source = unavailable('SOURCE_DIAGNOSTIC_LIMIT_REACHED');
      continue;
    }
    const remaining = TOTAL_BUDGET_MS - (monotonicClock() - started);
    if (remaining <= 0) {
      finding.source = unavailable('SOURCE_DIAGNOSTIC_TIME_BUDGET_REACHED');
      continue;
    }
    // A stopped job must not send further DOM requests. Cancellation still
    // allows the already captured measurement to be retained by the caller.
    try {
      await timed(options.guard(), remaining);
    } catch {
      stopped = true;
      finding.source = unavailable('SOURCE_DIAGNOSTIC_CANCELLED');
      continue;
    }
    const requestBudget = TOTAL_BUDGET_MS - (monotonicClock() - started);
    if (requestBudget <= 0) {
      finding.source = unavailable('SOURCE_DIAGNOSTIC_TIME_BUDGET_REACHED');
      continue;
    }
    attempted++;
    try {
      const timeoutMs = Math.min(REQUEST_TIMEOUT_MS, requestBudget);
      const response = await timed(
        options.request(
          {
            expected: options.expected,
            analysis: {
              width: finding.diagnostic.analysisWidth,
              height: finding.diagnostic.analysisHeight,
            },
            region: finding.region,
          },
          timeoutMs,
        ),
        timeoutMs,
      );
      const finalGuardBudget = TOTAL_BUDGET_MS - (monotonicClock() - started);
      if (finalGuardBudget <= 0) {
        finding.source = unavailable('SOURCE_DIAGNOSTIC_TIME_BUDGET_REACHED');
        continue;
      }
      try {
        await timed(options.guard(), finalGuardBudget);
      } catch {
        stopped = true;
        finding.source = unavailable('SOURCE_DIAGNOSTIC_CANCELLED');
        continue;
      }
      const viewport = options.expected.viewport;
      const parsed = sourceDiagnosticSchema.safeParse({
        ...(typeof response === 'object' && response !== null ? response : {}),
        ...timing(),
        viewport: {
          width: viewport.width,
          height: viewport.height,
          dpr: viewport.dpr,
          scrollX: viewport.scrollX,
          scrollY: viewport.scrollY,
        },
      });
      finding.source = parsed.success
        ? parsed.data
        : unavailable('INVALID_SOURCE_DIAGNOSTIC_RESPONSE');
    } catch {
      // Exception strings can contain URLs. Store only this fixed code.
      finding.source = unavailable('SOURCE_DIAGNOSTIC_REQUEST_FAILED');
    }
  }
}
