/** Public detector API. Implementation modules keep numeric histories and reporting separate. */
export const ENGINE_VERSION = '0.4.0-candidate';
export { FrameAnalyzer } from './frame-analyzer.js';
export { relativeLuminance } from './luminance.js';
export type {
  CapturedFrame,
  AnalysisBackendStats,
  AnalysisOptions,
  AnalysisResult,
} from './types.js';
export {
  combinedMaskFieldAnalysis,
  visualFieldFromDisplay,
} from './spatial.js';
export type { MaskFieldAnalysis, VisualFieldCalibration } from './spatial.js';
