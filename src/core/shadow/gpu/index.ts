// ============================================================
//  GPU Shadow Mirror — Public API (V10 — Calibration Layer)
// ============================================================

export { StrokeToGPUEncoder } from './StrokeToGPUEncoder';
export type { GPUStrokeBuffer, GPUStrokeMeta, EncoderConfig, EncoderStats } from './StrokeToGPUEncoder';

export { GPUInkFieldShadowRenderer } from './GPUInkFieldShadowRenderer';
export type { GPURenderMetrics, GPURendererConfig } from './GPUInkFieldShadowRenderer';

export { GPUShadowMirror } from './GPUShadowMirror';
export type { GPUMirrorConfig, GPUMirrorOutput } from './GPUShadowMirror';

export { GPUAlignmentEngine } from './GPUAlignmentEngine';
export type { RenderAlignmentResult, AlignmentMetrics, AlignmentStatus, AlignmentConfig } from './GPUAlignmentEngine';

export { FrameBridge } from './FrameBridge';
export type { BridgedFrame, FrameBridgeConfig } from './FrameBridge';

export { GPUCalibrationLayer } from './GPUCalibrationLayer';
export type {
  GPUErrorType, GPUErrorVector, GPUParams, GPUParamGradient,
  CalibrationState, GPUCalibrationReport, CalibrationConfig,
} from './GPUCalibrationLayer';
