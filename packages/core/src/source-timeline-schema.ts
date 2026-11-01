import { z } from 'zod';

const nonnegative = z.number().finite().nonnegative();
const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
const rect = z.strictObject({
  x: coordinate,
  y: coordinate,
  width: nonnegative.max(1_000_000),
  height: nonnegative.max(1_000_000),
});
export const animatedPropertySchema = z.enum([
  'opacity',
  'backgroundColor',
  'color',
  'fill',
  'stroke',
  'filter',
  'transform',
  'visibility',
  'clipPath',
  'other',
]);
export const timelineAnimationSchema = z.strictObject({
  kind: z.enum(['CSS_ANIMATION', 'CSS_TRANSITION', 'WEB_ANIMATION']),
  playState: z.enum(['running', 'paused', 'finished', 'idle']),
  durationMs: nonnegative.nullable(),
  delayMs: z.number().finite(),
  iterations: nonnegative.nullable(),
  currentTimeMs: z.number().finite().nullable(),
  progress: z.number().finite().min(0).max(1).nullable(),
  properties: z.array(animatedPropertySchema).max(10),
});

export const sourceFrameClockSchema = z.strictObject({
  method: z.literal('PER_FRAME_RECEIPT'),
  matchedFrames: z.number().int().min(1).max(360),
  /** Observed variation in delivery offset; deliberately not capture latency. */
  receiptOffsetSpreadMs: nonnegative,
  startBoundaryErrorMs: nonnegative.max(50),
  endBoundaryErrorMs: nonnegative.max(50),
});

export const sourceReadWindowSchema = z
  .strictObject({
    startEpochMs: nonnegative,
    endEpochMs: nonnegative,
    trigger: z.enum(['INITIAL', 'ANIMATION_FRAME', 'TIMER_FALLBACK', 'EVENT']),
    /** rAF's rendering timeline timestamp; not proof that these pixels were presented. */
    renderEpochMs: nonnegative.optional(),
  })
  .refine(
    (value) => value.endEpochMs >= value.startEpochMs,
    'Read window is reversed',
  );

export const sourceVideoPresentationSchema = z.strictObject({
  callbackEpochMs: nonnegative,
  presentationEpochMs: nonnegative,
  expectedDisplayEpochMs: nonnegative,
  mediaTimeMs: nonnegative,
  presentedFrames: z.number().int().nonnegative(),
});

/** Bounded temporal/spatial correlation; never a verified rendering cause. */
export const sourceTimelineSchema = z
  .strictObject({
    version: z.literal(1),
    status: z.enum(['CORRELATED', 'UNAVAILABLE']),
    reason: z.string().min(1).max(200).optional(),
    clockBasis: z.literal('FRAME_RECEIPT_ESTIMATE'),
    windowStartEpochMs: nonnegative,
    windowEndEpochMs: nonnegative,
    /** null deliberately means unknown, not zero. */
    alignmentUncertaintyMs: nonnegative.nullable(),
    frameClock: sourceFrameClockSchema.optional(),
    sampledAt: z.iso.datetime({ offset: true }),
    sampleIntervalMs: nonnegative,
    maxSampleGapMs: nonnegative,
    sampleCount: z.number().int().min(0).max(96),
    firstSampleEpochMs: nonnegative.optional(),
    lastSampleEpochMs: nonnegative.optional(),
    complete: z.boolean(),
    candidates: z
      .array(
        z.strictObject({
          id: z.string().min(1).max(128),
          /** Opaque local capability, removed from every public diagnostic copy. */
          inspectionToken: z.string().uuid().optional(),
          selectorPath: z.array(z.string().min(1).max(512)).min(1).max(8),
          tag: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/),
          media: z.enum(['VIDEO', 'CANVAS', 'IMAGE', 'IFRAME']).optional(),
          observations: z
            .array(
              z.strictObject({
                atEpochMs: nonnegative,
                readWindow: sourceReadWindowSchema.optional(),
                rect,
                viewport: z.strictObject({
                  width: z.number().int().positive().max(16384),
                  height: z.number().int().positive().max(16384),
                  dpr: z.number().positive().max(16),
                  scrollX: coordinate,
                  scrollY: coordinate,
                }),
                mutationsSincePrevious: z.number().int().min(0).max(10_000),
                animations: z.array(timelineAnimationSchema).max(4),
                mediaTimeMs: nonnegative.optional(),
                mediaPaused: z.boolean().optional(),
                videoPresentation: sourceVideoPresentationSchema.optional(),
              }),
            )
            .min(1)
            .max(96),
        }),
      )
      .max(6),
    limitations: z.array(z.string().min(1).max(300)).max(16),
  })
  .superRefine((value, context) => {
    const issue = (message: string) =>
      context.addIssue({ code: 'custom', message });
    if (value.windowEndEpochMs < value.windowStartEpochMs)
      issue('Timeline window is reversed');
    if (value.status === 'CORRELATED' && !value.candidates.length)
      issue('Correlation requires candidates');
    if (
      value.status === 'UNAVAILABLE' &&
      (value.candidates.length || value.complete)
    )
      issue('Unavailable timeline cannot claim evidence');
    if (
      new Set(value.candidates.map((c) => c.id)).size !==
      value.candidates.length
    )
      issue('Duplicate timeline candidate');
  })
  .superRefine((value, context) => {
    const issue = (message: string) =>
      context.addIssue({ code: 'custom', message });
    if (
      value.sampleCount === 0 &&
      (value.firstSampleEpochMs !== undefined ||
        value.lastSampleEpochMs !== undefined ||
        value.candidates.length)
    )
      issue('Empty timeline cannot claim sample bounds or candidates');
    if (
      value.sampleCount > 0 &&
      (value.firstSampleEpochMs === undefined ||
        value.lastSampleEpochMs === undefined ||
        value.lastSampleEpochMs < value.firstSampleEpochMs)
    )
      issue('Sampled timeline requires ordered sample bounds');
    if (
      value.complete &&
      (value.sampleCount < 2 ||
        value.firstSampleEpochMs! > value.windowStartEpochMs ||
        value.lastSampleEpochMs! < value.windowEndEpochMs ||
        value.maxSampleGapMs > 250)
    )
      issue(
        'Complete timeline requires sampled coverage of its estimated window',
      );
  })
  .superRefine((value, context) => {
    const issue = (message: string) =>
      context.addIssue({ code: 'custom', message });
    for (const candidate of value.candidates) {
      for (let i = 0; i < candidate.observations.length; i++) {
        const sample = candidate.observations[i];
        if (
          sample.readWindow &&
          sample.readWindow.endEpochMs > sample.atEpochMs
        )
          issue('DOM read cannot end after its recorded snapshot');
        if (
          sample.videoPresentation &&
          sample.videoPresentation.callbackEpochMs > sample.atEpochMs
        )
          issue(
            'Video presentation callback cannot follow its recorded snapshot',
          );
        if (
          sample.atEpochMs < value.windowStartEpochMs - 250 ||
          sample.atEpochMs > value.windowEndEpochMs + 250
        )
          issue('Timeline sample outside allowed temporal context');
        if (i && sample.atEpochMs <= candidate.observations[i - 1].atEpochMs)
          issue('Timeline observations must be strictly ordered');
        if (
          sample.atEpochMs < value.firstSampleEpochMs! ||
          sample.atEpochMs > value.lastSampleEpochMs!
        )
          issue('Candidate observation outside recorded sample bounds');
      }
      if (candidate.observations.length > value.sampleCount)
        issue('Candidate observations exceed sampled snapshots');
    }
  });

export type SourceTimeline = z.infer<typeof sourceTimelineSchema>;
export type TimelineAnimation = z.infer<typeof timelineAnimationSchema>;
