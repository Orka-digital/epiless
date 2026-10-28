/** Media replay entry point; schemas, interval evidence and comparison policy remain separate. */
export {
  MEDIA_REPLAY_LIMIT,
  MEDIA_SAMPLE_LIMIT,
  MEDIA_SAMPLE_INTERVAL_MS,
  MEDIA_PRESENTATION_LIMIT,
  MEDIA_POSITION_EPSILON_MS,
  type MediaState,
  type MediaSample,
  type MediaPresentation,
  type MediaEvidence,
  type MediaReplayPlan,
} from './media-replay-types';
export {
  replayableMediaState,
  validMediaState,
  validMediaPlan,
  validMediaEvidence,
  copyMediaEvidence,
  copyMediaState,
} from './media-replay-validation';
export { measuredMediaInterval } from './media-replay-interval';
export { mediaPlanFromEvidence, mediaPlanKey } from './media-replay-plan';
export {
  hasMediaContext,
  mediaComparisonReasons,
} from './media-replay-comparison';
