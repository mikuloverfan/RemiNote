// ============================================================
//  Shadow Render Layer — Public API (V12 — Magnetic Dashboard)
// ============================================================

export { captureFrameSnapshot, createSnapshotFromStrokes } from './FrameSnapshot';
export type { FrameSnapshot, FrozenStroke, FrozenPoint, FrozenCamera, FrozenBrushParams } from './FrameSnapshot';

export { ShadowRenderer } from './ShadowRenderer';
export type { ShadowRenderOutput, ShadowRendererConfig } from './ShadowRenderer';

export { RenderDiffEngine } from './RenderDiffEngine';
export type { RenderDiffResult, GeometryMismatch, BBoxMismatch } from './RenderDiffEngine';

export { ShadowRenderObserver, globalShadowObserver } from './ShadowRenderObserver';
export type { ObserveInput, ObserveRecord, ObserverConfig } from './ShadowRenderObserver';

export { SVSFrameLocker } from './SVSFrameLocker';
export type { FrameToken, FrameLockerConfig } from './SVSFrameLocker';

export { SVSSnapshotGuard } from './SVSSnapshotGuard';
export type { SnapshotGuardConfig, SnapshotVerification } from './SVSSnapshotGuard';

export { SVSGeometryBridge } from './SVSGeometryBridge';
export type { GeometryBridgeConfig, UnifiedStrokeGeometry } from './SVSGeometryBridge';

export { SVSDiffStabilizer } from './SVSDiffStabilizer';
export type { DiffStabilizerConfig, StabilityState, StabilityReport, DiffStatistics } from './SVSDiffStabilizer';

export { ShadowSessionHook, createSVSHook } from './ShadowSessionHook';
export type { SVSConfig } from './ShadowSessionHook';

export { StrokeToGPUEncoder, GPUInkFieldShadowRenderer, GPUShadowMirror, GPUAlignmentEngine, FrameBridge, GPUCalibrationLayer } from './gpu';
export type { GPUStrokeBuffer, GPUStrokeMeta, EncoderConfig, EncoderStats, GPURenderMetrics, GPURendererConfig, GPUMirrorConfig, GPUMirrorOutput, RenderAlignmentResult, AlignmentMetrics, AlignmentStatus, AlignmentConfig, BridgedFrame, FrameBridgeConfig, GPUErrorType, GPUErrorVector, GPUParams, GPUParamGradient, CalibrationState, GPUCalibrationReport, CalibrationConfig } from './gpu';

export { ArbitrationEngine, normalizeCPUOutput, normalizeShadowOutput, normalizeGPUOutput, computeConfidence, computeStatus, ARBITRATION_THRESHOLDS } from './arbitration';
export type { TruthSource, NormalizedRenderOutput, DeviationMetrics, FrameFinalStatus, RenderTruthFrame, ArbitrationDecision, RenderTruthResult, ArbitrationInput, ArbitrationConfig } from './arbitration';

export { FrameBarrier } from './FrameBarrier';
export type { FramePhase, CPUFrameOutput, FrameTimestamps, FrameFence, FrameBarrierConfig } from './FrameBarrier';

export { RenderGroundTruthTap } from './RenderGroundTruthTap';
export type { RenderTapOutput, RenderVsSnapshotDiff } from './RenderGroundTruthTap';

export { ExecutionTraceHook } from './ExecutionTraceHook';
export type { DrawCallType, DrawCallRecord, CanvasExecutionTrace } from './ExecutionTraceHook';

export { RenderExecutionValidator } from './RenderExecutionValidator';
export type { ValidationStatus, RenderExecutionValidation } from './RenderExecutionValidator';

export { RenderDivergenceRootCauseEngine } from './diagnostics/RenderDivergenceRootCauseEngine';
export type { PrimaryCause, EvidenceItem, Severity, RootCauseReport, DivergenceInput } from './diagnostics/RenderDivergenceRootCauseEngine';

export { SystemIntegrityAuditLayer } from './diagnostics/SystemIntegrityAuditLayer';
export type { SystemHealthStatus, SystemIntegrityReport, IntegrityInput } from './diagnostics/SystemIntegrityAuditLayer';

export { PixelTruthCapture } from './pixel/PixelTruthCapture';
export type { PixelTruthFrame, PixelTruthConfig } from './pixel/PixelTruthCapture';

export { PixelTruthDiffEngine } from './pixel/PixelTruthDiffEngine';
export type { PixelSeverity, PixelMismatchReport, PixelDiffConfig } from './pixel/PixelTruthDiffEngine';

export { PixelStrokeAttributionEngine } from './pixel/PixelStrokeAttributionEngine';
export type { BoundingBox, PixelDriftRegion, StrokePixelImpact, StrokeAttribution, PixelStrokeAttributionResult, AttributionConfig } from './pixel/PixelStrokeAttributionEngine';

export { StabilityPolicyLayer } from './policy/StabilityPolicyLayer';
export type { RenderDecision, RenderMode, FinalRenderDecision, PolicyConfig } from './policy/StabilityPolicyLayer';

export { RenderProductionHardener } from './production/RenderProductionHardener';
export type { ProductionRenderState, HardenerConfig } from './production/RenderProductionHardener';

export { V11MagneticDashboard } from './ui/V11MagneticDashboard';
