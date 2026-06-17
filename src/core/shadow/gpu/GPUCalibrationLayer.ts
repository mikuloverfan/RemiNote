// ============================================================
//  GPU Calibration Layer — Error Decomposition + Learning Loop
//
//  定位: 误差学习与收敛系统 (NOT verification, NOT diagnostic)
//
//  闭环:
//    Pixel/Stroke mismatch → Attribution → Error Decomposition
//    → Loss → Gradient → Parameter Update → Next Frame
//
//  6 类 GPU 误差:
//    GEOMETRY_DEVIATION  — bbox / point position mismatch
//    PRESSURE_MISMATCH   — pressure curve error
//    SPACING_DRIFT       — point spacing / density error
//    TIME_TAPER_ERROR    — start/end taper mismatch
//    ALPHA_BLEND_ERROR   — opacity / blend mode deviation
//    MISSING_STROKES     — strokes not rendered by GPU
//
//  Loss(stroke) = w1·geoErr + w2·pixelDrift + w3·execMismatch + w4·temporalDrift
//
//  更新规则:
//    newParam = oldParam + lr * clamp(momentum(ema(gradient)), -maxStep, +maxStep)
//    lr ∈ [0.001, 0.05], 5-frame EMA, momentum β=0.9
//
//  稳定门: 禁止更新条件:
//    pixel drift entropy > threshold
//    GPU alignment unstable (< 0.8)
//    attribution confidence < 0.6
//
//  收敛检测:
//    loss ↓ 10+ frames → LEARNING
//    loss variance ↓ → STABLE
//    loss flat + low → CONVERGED
// ============================================================

import type { RenderDiffResult } from '../RenderDiffEngine';
import type { RenderAlignmentResult } from './GPUAlignmentEngine';
import type { PixelStrokeAttributionResult, StrokeAttribution } from '../pixel/PixelStrokeAttributionEngine';
import type { PixelMismatchReport } from '../pixel/PixelTruthDiffEngine';

// ============================================================
//  Types
// ============================================================

export type GPUErrorType =
  | 'GEOMETRY_DEVIATION'
  | 'PRESSURE_MISMATCH'
  | 'SPACING_DRIFT'
  | 'TIME_TAPER_ERROR'
  | 'ALPHA_BLEND_ERROR'
  | 'MISSING_STROKES';

export interface GPUErrorVector {
  strokeId: string;
  errorType: GPUErrorType;
  magnitude: number;
  confidence: number;
}

export interface GPUParams {
  pressureScale: number;
  spacingFactor: number;
  taperCurve: number;
  alphaCurve: number;
  velocityFade: number;
  brushRadius: number;
}

export interface GPUParamGradient {
  param: keyof GPUParams;
  delta: number;
  confidence: number;
}

export type CalibrationState = 'UNSTABLE' | 'LEARNING' | 'STABLE' | 'CONVERGED';

export interface GPUCalibrationReport {
  frameId: number;
  errorVectors: GPUErrorVector[];
  strokeLossMap: Map<string, number>;
  parameterUpdates: GPUParamGradient[];
  globalLoss: number;
  calibrationState: CalibrationState;
  convergenceScore: number;
  recommendedGPUParams: GPUParams;
}

export interface CalibrationConfig {
  learningRate?: number;
  momentum?: number;
  emaFrames?: number;
  maxStep?: number;
  stabilityThreshold?: number;
  convergenceVariance?: number;
  debug?: boolean;
}

// ============================================================
//  Constants
// ============================================================

const DEFAULT_PARAMS: GPUParams = {
  pressureScale: 1.0,
  spacingFactor: 1.0,
  taperCurve: 1.0,
  alphaCurve: 1.0,
  velocityFade: 1.0,
  brushRadius: 4.0,
};

const DEFAULT_CONFIG: Required<CalibrationConfig> = {
  learningRate: 0.01,
  momentum: 0.9,
  emaFrames: 5,
  maxStep: 0.1,
  stabilityThreshold: 0.8,
  convergenceVariance: 0.001,
  debug: false,
};

const LOSS_WEIGHTS = { geoErr: 0.35, pixelDrift: 0.30, execMismatch: 0.20, temporalDrift: 0.15 } as const;

// ============================================================
//  GPUCalibrationLayer
// ============================================================

export class GPUCalibrationLayer {
  private _config: Required<CalibrationConfig>;
  private _enabled = false;
  private _lastReport: GPUCalibrationReport | null = null;

  // ── State ──
  private _params: GPUParams = { ...DEFAULT_PARAMS };
  private _paramMomentum: GPUParams = { ...DEFAULT_PARAMS };  // velocity
  private _paramEMA: GPUParams[] = [];                        // ring buffer

  // Convergence tracking
  private _lossHistory: number[] = [];
  private _frameCount = 0;

  constructor(config: CalibrationConfig = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    for (let i = 0; i < this._config.emaFrames; i++) {
      this._paramEMA.push({ ...DEFAULT_PARAMS });
    }
    this._paramEMA.push({ ...DEFAULT_PARAMS }); // current
  }

  enable(): void { this._enabled = true; }
  disable(): void { this._enabled = false; }
  get enabled(): boolean { return this._enabled; }

  // ==========================================================
  //  calibrate — 主入口
  // ==========================================================

  calibrate(input: {
    frameId: number;
    diff: RenderDiffResult | null;
    alignment: RenderAlignmentResult | null;
    attribution: PixelStrokeAttributionResult | null;
    pixelReport: PixelMismatchReport | null;
  }): GPUCalibrationReport {
    const { frameId, diff, alignment, attribution, pixelReport } = input;
    this._frameCount++;

    // ── ① Error Decomposition ──
    const errorVectors = this._decomposeErrors(diff, alignment, attribution);

    // ── ② Stroke Loss ──
    const strokeLossMap = this._computeStrokeLoss(
      errorVectors, attribution, pixelReport, alignment,
    );

    // ── ③ Global Loss ──
    const globalLoss = strokeLossMap.size > 0
      ? [...strokeLossMap.values()].reduce((a, b) => a + b, 0) / strokeLossMap.size
      : 0;
    this._lossHistory.push(globalLoss);
    if (this._lossHistory.length > 60) this._lossHistory.shift();

    // ── ④ Parameter Gradient Estimation ──
    const gradients = this._estimateGradients(errorVectors, attribution);

    // ── ⑤ Stabilization Gate ──
    const canUpdate = this._stabilizationGate(globalLoss, alignment, attribution, pixelReport);

    // ── ⑥ Parameter Update ──
    if (canUpdate && gradients.length > 0) {
      this._applyUpdates(gradients);
    }

    // ── ⑦ Convergence Detection ──
    const calibrationState = this._detectConvergence();

    // ── ⑧ Build Report ──
    const report: GPUCalibrationReport = {
      frameId,
      errorVectors,
      strokeLossMap,
      parameterUpdates: canUpdate ? gradients : [],
      globalLoss,
      calibrationState,
      convergenceScore: this._computeConvergenceScore(),
      recommendedGPUParams: { ...this._params },
    };

    this._lastReport = report;
    return report;
  }

  get lastReport(): GPUCalibrationReport | null { return this._lastReport; }
  get currentParams(): Readonly<GPUParams> { return this._params; }

  // ==========================================================
  //  ① Error Decomposition
  // ==========================================================

  private _decomposeErrors(
    diff: RenderDiffResult | null,
    alignment: RenderAlignmentResult | null,
    attribution: PixelStrokeAttributionResult | null,
  ): GPUErrorVector[] {
    const vectors: GPUErrorVector[] = [];

    // Geometry deviation → from bbox mismatches
    if (diff) {
      for (const bm of diff.bboxMismatches) {
        const mag = Math.max(bm.deltaMinX, bm.deltaMinY, bm.deltaMaxX, bm.deltaMaxY) / 20;
        vectors.push({ strokeId: bm.strokeId, errorType: 'GEOMETRY_DEVIATION', magnitude: Math.min(1, mag), confidence: 0.85 });
      }
    }

    // Missing strokes → GPU didn't render
    if (diff) {
      for (const id of diff.missingStrokes) {
        vectors.push({ strokeId: id, errorType: 'MISSING_STROKES', magnitude: 1.0, confidence: 0.95 });
      }
    }

    // GPU-specific: spacing / pressure from alignment
    if (alignment && !alignment.isAligned) {
      if (alignment.metrics.strokeLossRate > 0) {
        vectors.push({ strokeId: '__gpu__', errorType: 'MISSING_STROKES', magnitude: alignment.metrics.strokeLossRate, confidence: 0.9 });
      }
      if (alignment.metrics.geometryDeviation > 2) {
        vectors.push({ strokeId: '__gpu__', errorType: 'GEOMETRY_DEVIATION', magnitude: Math.min(1, alignment.metrics.geometryDeviation / 10), confidence: 0.7 });
      }
    }

    // Pixel attribution → spacing/taper/alpha errors
    if (attribution) {
      for (const attr of attribution.strokeRanking) {
        if (attr.pixelErrorContribution > 0.3) {
          vectors.push({ strokeId: attr.strokeId, errorType: 'SPACING_DRIFT', magnitude: attr.pixelErrorContribution * 0.5, confidence: attr.confidence });
          vectors.push({ strokeId: attr.strokeId, errorType: 'TIME_TAPER_ERROR', magnitude: attr.pixelErrorContribution * 0.3, confidence: attr.confidence * 0.8 });
        }
      }
    }

    return vectors;
  }

  // ==========================================================
  //  ② Stroke Loss
  // ==========================================================

  private _computeStrokeLoss(
    errors: GPUErrorVector[],
    attribution: PixelStrokeAttributionResult | null,
    pixelReport: PixelMismatchReport | null,
    alignment: RenderAlignmentResult | null,
  ): Map<string, number> {
    const lossMap = new Map<string, number>();

    for (const ev of errors) {
      const geoErr = ev.errorType === 'GEOMETRY_DEVIATION' ? ev.magnitude : 0;
      const pixelDrift = attribution
        ? (attribution.strokeRanking.find(a => a.strokeId === ev.strokeId)?.pixelErrorContribution ?? 0)
        : 0;
      const execMismatch = ev.errorType === 'MISSING_STROKES' ? ev.magnitude : 0;
      const temporalDrift = alignment?.metrics.gpuDrift ? Math.min(1, alignment.metrics.gpuDrift / 10) : 0;

      const loss =
        LOSS_WEIGHTS.geoErr * geoErr +
        LOSS_WEIGHTS.pixelDrift * pixelDrift +
        LOSS_WEIGHTS.execMismatch * execMismatch +
        LOSS_WEIGHTS.temporalDrift * temporalDrift;

      lossMap.set(ev.strokeId, loss);
    }

    // Global pixel penalty
    if (pixelReport && pixelReport.severity !== 'clean') {
      const globalId = '__global__';
      const existing = lossMap.get(globalId) ?? 0;
      const penalty = pixelReport.severity === 'critical' ? 0.8 : pixelReport.severity === 'major' ? 0.4 : 0.15;
      lossMap.set(globalId, existing + penalty);
    }

    return lossMap;
  }

  // ==========================================================
  //  ③ Parameter Gradient Estimation
  // ==========================================================

  private _estimateGradients(
    errors: GPUErrorVector[],
    _attribution: PixelStrokeAttributionResult | null,
  ): GPUParamGradient[] {
    const gradients: GPUParamGradient[] = [];
    let totalMagnitude = 0;
    let geoCount = 0, spacingCount = 0, taperCount = 0, alphaCount = 0;

    for (const ev of errors) {
      totalMagnitude += ev.magnitude;
      switch (ev.errorType) {
        case 'GEOMETRY_DEVIATION': geoCount++; break;
        case 'SPACING_DRIFT': spacingCount++; break;
        case 'TIME_TAPER_ERROR': taperCount++; break;
        case 'ALPHA_BLEND_ERROR': alphaCount++; break;
      }
    }

    if (errors.length === 0) return gradients;

    const avgMag = totalMagnitude / errors.length;

    // Heuristic mapping: error type → parameter sensitivity
    // GEOMETRY_DEVIATION → brushRadius needs adjustment
    if (geoCount > 0) {
      gradients.push({ param: 'brushRadius', delta: avgMag * 0.05, confidence: 0.7 });
    }

    // SPACING_DRIFT → spacingFactor
    if (spacingCount > 0) {
      gradients.push({ param: 'spacingFactor', delta: -avgMag * 0.03, confidence: 0.6 });
    }

    // TIME_TAPER_ERROR → taperCurve
    if (taperCount > 0) {
      gradients.push({ param: 'taperCurve', delta: avgMag * 0.04, confidence: 0.55 });
    }

    // ALPHA_BLEND_ERROR → alphaCurve
    if (alphaCount > 0) {
      gradients.push({ param: 'alphaCurve', delta: -avgMag * 0.02, confidence: 0.5 });
    }

    // Generic: pressure mismatch → pressureScale
    if (avgMag > 0.1) {
      gradients.push({ param: 'pressureScale', delta: avgMag * 0.02, confidence: 0.45 });
    }

    // Velocity fade → velocityFade
    gradients.push({ param: 'velocityFade', delta: -avgMag * 0.01, confidence: 0.3 });

    return gradients;
  }

  // ==========================================================
  //  ④ Stabilization Gate
  // ==========================================================

  private _stabilizationGate(
    globalLoss: number,
    alignment: RenderAlignmentResult | null,
    attribution: PixelStrokeAttributionResult | null,
    pixelReport: PixelMismatchReport | null,
  ): boolean {
    // Gate 1: GPU alignment must be stable
    if (alignment && !alignment.isAligned) return false;

    // Gate 2: Attribution confidence
    if (attribution) {
      const avgConf = attribution.strokeRanking.length > 0
        ? attribution.strokeRanking.reduce((s, a) => s + a.confidence, 0) / attribution.strokeRanking.length
        : 0;
      if (avgConf < 0.6) return false;
    }

    // Gate 3: Pixel noise (entropy proxy via loss variance)
    if (this._lossHistory.length >= 5) {
      const recent = this._lossHistory.slice(-5);
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      const variance = recent.reduce((s, v) => s + (v - mean) ** 2, 0) / recent.length;
      if (variance > 0.01) return false; // too noisy
    }

    // Gate 4: Pixel severity
    if (pixelReport && pixelReport.severity === 'critical') return false;

    return true;
  }

  // ==========================================================
  //  ⑤ Parameter Update (Momentum + EMA)
  // ==========================================================

  private _applyUpdates(gradients: GPUParamGradient[]): void {
    const lr = this._config.learningRate;

    for (const g of gradients) {
      const key = g.param;
      const oldVal = this._params[key];
      const momentum = this._paramMomentum[key];

      // Momentum: v = β·v + (1-β)·gradient
      const velocity = this._config.momentum * momentum + (1 - this._config.momentum) * g.delta;
      this._paramMomentum[key] = velocity;

      // Clamped update
      const step = lr * Math.max(-this._config.maxStep, Math.min(this._config.maxStep, velocity));
      const newVal = Math.max(0.1, Math.min(10, oldVal + step));
      this._params[key] = newVal;
    }

    // EMA ring buffer
    this._paramEMA.push({ ...this._params });
    if (this._paramEMA.length > this._config.emaFrames + 1) {
      this._paramEMA.shift();
    }

    // Apply EMA smoothing to final params
    this._smoothParams();
  }

  private _smoothParams(): void {
    if (this._paramEMA.length < 2) return;
    const n = this._paramEMA.length;
    const keys: (keyof GPUParams)[] = ['pressureScale', 'spacingFactor', 'taperCurve', 'alphaCurve', 'velocityFade', 'brushRadius'];

    for (const key of keys) {
      let sum = 0;
      for (const p of this._paramEMA) sum += p[key];
      this._params[key] = sum / n;
    }
  }

  // ==========================================================
  //  ⑥ Convergence Detection
  // ==========================================================

  private _detectConvergence(): CalibrationState {
    const hist = this._lossHistory;
    if (hist.length < 10) return 'UNSTABLE';

    // Recent 10-frame trend
    const recent = hist.slice(-10);
    const firstHalf = recent.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const secondHalf = recent.slice(5, 10).reduce((a, b) => a + b, 0) / 5;
    const trend = firstHalf - secondHalf; // positive = improving

    // Variance
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((s, v) => s + (v - mean) ** 2, 0) / recent.length;

    // CONVERGED: low loss + low variance + flat trend
    if (mean < 0.05 && variance < this._config.convergenceVariance && Math.abs(trend) < 0.01) {
      return 'CONVERGED';
    }

    // STABLE: low variance
    if (variance < this._config.convergenceVariance * 3) {
      return 'STABLE';
    }

    // LEARNING: improving trend
    if (trend > 0.005) {
      return 'LEARNING';
    }

    return 'UNSTABLE';
  }

  private _computeConvergenceScore(): number {
    const hist = this._lossHistory;
    if (hist.length < 10) return 0;

    const recent = hist.slice(-10);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((s, v) => s + (v - mean) ** 2, 0) / recent.length;
    return 1 / (1 + mean * 10 + variance * 100); // 0~1
  }
}

export default GPUCalibrationLayer;
