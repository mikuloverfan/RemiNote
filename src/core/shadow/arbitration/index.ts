// ============================================================
//  Final Render Arbitration Layer — Public API
// ============================================================

export {
  normalizeCPUOutput,
  normalizeShadowOutput,
  normalizeGPUOutput,
  computeConfidence,
  computeStatus,
  ARBITRATION_THRESHOLDS,
} from './RenderTruthModel';
export type {
  TruthSource,
  NormalizedRenderOutput,
  DeviationMetrics,
  FrameFinalStatus,
  RenderTruthFrame,
  ArbitrationDecision,
  RenderTruthResult,
} from './RenderTruthModel';

export { ArbitrationEngine } from './ArbitrationEngine';
export type { ArbitrationInput, ArbitrationConfig } from './ArbitrationEngine';
