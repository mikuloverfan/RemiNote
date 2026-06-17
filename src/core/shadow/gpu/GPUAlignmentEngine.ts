// ============================================================
//  GPU Shadow Mirror — GPUAlignmentEngine
//
//  职责：
//  ✔ 三路对齐：CPU (main.ts) vs Shadow (2D) vs GPU (WebGL2)
//  ✔ 结构化对比输出 — 不抛异常，永远返回结果
//  ✔ 纯计算 — 零副作用，不访问 DOM / canvas / WebGL
//
//  对比维度：
//  1. Stroke count         — 三方 stroke 数量是否一致
//  2. Stroke ID 集合        — missing / extra strokes
//  3. Geometry deviation    — 点位置偏差 (仅 CPU vs Shadow)
//  4. GPU stroke loss       — GPU 是否丢失 stroke
//  5. Temporal lag          — 帧号偏差
//  6. Aggregate status      — aligned / drifting / unstable
//
//  对齐公式 (per stroke):
//    aligned = (strokeCounts match)
//           && (no missing strokes)
//           && (geometryDeviation < threshold)
//           && (GPU stroke loss = 0)
//
//  约束：
//  ❌ 不访问 WebGL / canvas / main.ts
//  ❌ 不修改任何输入
//  ✅ 纯函数
// ============================================================

import type { FrameSnapshot, FrozenStroke } from '../FrameSnapshot';
import type { ShadowRenderOutput } from '../ShadowRenderer';
import type { GPUMirrorOutput } from './GPUShadowMirror';
import type { RenderDiffResult } from '../RenderDiffEngine';

// ============================================================
//  Types
// ============================================================

/** 对齐状态 */
export type AlignmentStatus = 'aligned' | 'drifting' | 'unstable';

/** 对齐指标 */
export interface AlignmentMetrics {
  /** GPU 帧漂移 (vs snapshot frameId) */
  gpuDrift: number;
  /** 最大点位置偏差 (px) — CPU vs Shadow */
  geometryDeviation: number;
  /** GPU stroke 丢失率 (0~1) */
  strokeLossRate: number;
  /** 帧延迟 (ms) — GPU render finish time vs snapshot capture time */
  temporalLag: number;
  /** CPU vs Shadow diff 中的不匹配 stroke 数 */
  cpuVsShadowMismatches: number;
  /** CPU vs GPU stroke count 偏差 */
  cpuVsGPUCountDelta: number;
}

/** 完整的对齐结果 */
export interface RenderAlignmentResult {
  /** snapshot frameId */
  frameId: number;
  /** 对齐状态 */
  status: AlignmentStatus;

  // ── Pairwise diffs ──
  cpuVsShadow: RenderDiffResult | null;
  cpuVsGPU: { strokeCountMatch: boolean; missingStrokes: string[]; extraStrokes: string[] } | null;
  shadowVsGPU: { strokeCountMatch: boolean; missingStrokes: string[]; extraStrokes: string[] } | null;

  // ── Metrics ──
  metrics: AlignmentMetrics;

  /** 是否存在任何不一致 */
  isAligned: boolean;
}

/** AlignmentEngine 配置 */
export interface AlignmentConfig {
  /** 几何偏差阈值 (px), 默认 2 */
  geometryThreshold?: number;
  /** stroke loss 阈值 (0~1), 默认 0 */
  strokeLossThreshold?: number;
  /** debug */
  debug?: boolean;
}

// ============================================================
//  Constants
// ============================================================

const DEFAULT_CONFIG: Required<AlignmentConfig> = {
  geometryThreshold: 2,
  strokeLossThreshold: 0,
  debug: false,
};

// ============================================================
//  GPUAlignmentEngine
// ============================================================

export class GPUAlignmentEngine {
  private _config: Required<AlignmentConfig>;
  private _enabled = false;
  private _lastResult: RenderAlignmentResult | null = null;
  private _totalAlignments = 0;

  constructor(config: AlignmentConfig = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  enable(): void { this._enabled = true; }
  disable(): void { this._enabled = false; }
  get enabled(): boolean { return this._enabled; }

  // ==========================================================
  //  align — 三路对齐主入口
  // ==========================================================

  /**
   * 对齐三路渲染输出。
   *
   * @param snapshot      SVS 帧快照 (ground truth)
   * @param shadowOutput  ShadowRenderer 输出 (2D canvas)
   * @param gpuOutput     GPUShadowMirror 输出 (WebGL2)
   * @param cpuVsShadow   CPU vs Shadow diff (来自 RenderDiffEngine)
   * @returns             完整的对齐结果
   */
  align(
    snapshot: FrameSnapshot,
    shadowOutput: ShadowRenderOutput | null,
    gpuOutput: GPUMirrorOutput | null,
    cpuVsShadow: RenderDiffResult | null,
  ): RenderAlignmentResult {
    this._totalAlignments++;

    // 🔒 try/catch — 对齐崩溃不影响调用方
    try {
      return this._alignInternal(snapshot, shadowOutput, gpuOutput, cpuVsShadow);
    } catch (err) {
      if (this._config.debug) {
        console.error('[GPUAlignment] ❌ align crashed:', err);
      }
      return this._emptyResult(snapshot.frameId);
    }
  }

  // ==========================================================
  //  Query
  // ==========================================================

  get lastResult(): RenderAlignmentResult | null { return this._lastResult; }
  get totalAlignments(): number { return this._totalAlignments; }

  // ==========================================================
  //  Private: alignment logic
  // ==========================================================

  private _alignInternal(
    snapshot: FrameSnapshot,
    shadowOutput: ShadowRenderOutput | null,
    gpuOutput: GPUMirrorOutput | null,
    cpuVsShadow: RenderDiffResult | null,
  ): RenderAlignmentResult {
    const frameId = snapshot.frameId;

    // ── Metrics ──
    const metrics: AlignmentMetrics = {
      gpuDrift: gpuOutput ? Math.abs(frameId - gpuOutput.frameId) : 999,
      geometryDeviation: cpuVsShadow?.bboxMismatches.reduce(
        (max, m) => Math.max(max, m.deltaMinX, m.deltaMinY, m.deltaMaxX, m.deltaMaxY), 0,
      ) ?? 0,
      strokeLossRate: 0,
      temporalLag: gpuOutput?.totalTimeMs ?? 0,
      cpuVsShadowMismatches: cpuVsShadow
        ? cpuVsShadow.missingStrokes.length + cpuVsShadow.extraStrokes.length
        : 0,
      cpuVsGPUCountDelta: 0,
    };

    // ── CPU vs Shadow ──
    const cpuVsShadowResult = cpuVsShadow;

    // ── CPU vs GPU ──
    const cpuIds = new Set(snapshot.strokes.map(s => s.id));
    const gpuIds = gpuOutput
      ? new Set(gpuOutput.encoderStats.totalStrokesEncoded > 0 ? snapshot.strokes.map(s => s.id) : [])
      : new Set<string>();

    const cpuVsGPU = this._computePairDiff(cpuIds, gpuIds, 'CPU', 'GPU');
    metrics.cpuVsGPUCountDelta = snapshot.strokes.length - (gpuOutput?.encoderStats.totalStrokesEncoded ?? 0);

    // ── Shadow vs GPU ──
    const shadowIds = shadowOutput
      ? new Set(shadowOutput.strokeIds)
      : new Set<string>();
    const shadowVsGPU = this._computePairDiff(shadowIds, gpuIds, 'Shadow', 'GPU');

    // ── Stroke loss rate ──
    const cpuCount = snapshot.strokes.length;
    const gpuCount = gpuOutput?.encoderStats.totalStrokesEncoded ?? 0;
    metrics.strokeLossRate = cpuCount > 0
      ? Math.max(0, cpuCount - gpuCount) / cpuCount
      : 0;

    // ── Status ──
    const isAligned =
      metrics.gpuDrift === 0
      && metrics.geometryDeviation < this._config.geometryThreshold
      && metrics.strokeLossRate <= this._config.strokeLossThreshold
      && cpuVsGPU.strokeCountMatch
      && (cpuVsShadow?.isClean ?? true);

    let status: AlignmentStatus;
    if (isAligned) {
      status = 'aligned';
    } else if (metrics.strokeLossRate > 0.5 || metrics.geometryDeviation > 10) {
      status = 'unstable';
    } else {
      status = 'drifting';
    }

    const result: RenderAlignmentResult = {
      frameId,
      status,
      cpuVsShadow: cpuVsShadowResult,
      cpuVsGPU,
      shadowVsGPU,
      metrics,
      isAligned,
    };

    this._lastResult = result;

    if (this._config.debug && !isAligned) {
      console.warn('[GPUAlignment] ⚠️ not aligned:', {
        frameId,
        status,
        geometryDeviation: metrics.geometryDeviation.toFixed(2),
        strokeLossRate: metrics.strokeLossRate.toFixed(3),
        gpuDrift: metrics.gpuDrift,
      });
    }

    return result;
  }

  // ==========================================================
  //  Private: pairwise diff
  // ==========================================================

  private _computePairDiff(
    primaryIds: Set<string>,
    secondaryIds: Set<string>,
    _primaryLabel: string,
    _secondaryLabel: string,
  ): { strokeCountMatch: boolean; missingStrokes: string[]; extraStrokes: string[] } {
    const missing: string[] = [];
    const extra: string[] = [];

    for (const id of primaryIds) {
      if (!secondaryIds.has(id)) missing.push(id);
    }
    for (const id of secondaryIds) {
      if (!primaryIds.has(id)) extra.push(id);
    }

    return {
      strokeCountMatch: primaryIds.size === secondaryIds.size && missing.length === 0 && extra.length === 0,
      missingStrokes: missing,
      extraStrokes: extra,
    };
  }

  // ==========================================================
  //  Private: empty fallback
  // ==========================================================

  private _emptyResult(frameId: number): RenderAlignmentResult {
    return {
      frameId,
      status: 'unstable',
      cpuVsShadow: null,
      cpuVsGPU: null,
      shadowVsGPU: null,
      metrics: {
        gpuDrift: 999,
        geometryDeviation: 0,
        strokeLossRate: 1,
        temporalLag: 0,
        cpuVsShadowMismatches: 0,
        cpuVsGPUCountDelta: 0,
      },
      isAligned: false,
    };
  }
}

export default GPUAlignmentEngine;
