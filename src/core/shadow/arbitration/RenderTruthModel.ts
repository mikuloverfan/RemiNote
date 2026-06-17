// ============================================================
//  Final Render Arbitration Layer — RenderTruthModel
//
//  Truth Definition:
//  ┌─────────────────────────────────────────────────────────┐
//  │ CPU (main.ts) IS the anchor truth.                      │
//  │                                                         │
//  │ Reasoning:                                              │
//  │ 1. It is the production render — what the user sees     │
//  │ 2. It directly consumes engine.strokes — canonical data │
//  │ 3. It uses the simplest rendering model (Path2D.stroke) │
//  │ 4. It is the ONLY system whose output affects UX        │
//  │                                                         │
//  │ Shadow is a VALIDATOR — corroborates data integrity     │
//  │ GPU is a VERIFIER — confirms rendering equivalence      │
//  └─────────────────────────────────────────────────────────┘
//
//  Why CPU/Shadow/GPU inevitably diverge:
//  ┌─────────────────────────────────────────────────────────┐
//  │ 1. RENDERING ALGORITHM DIFFERENCE:                      │
//  │    CPU: buildPath2D (quadraticCurveTo + lineTo)         │
//  │    Shadow: StrokeGeometryEngine (triangle mesh → Path2D)│
//  │    GPU: instanced quad stamping (circle splatting)      │
//  │    → These produce DIFFERENT pixel-level output on the  │
//  │      SAME data. Pixel diff is meaningless.              │
//  │                                                         │
//  │ 2. DATA REFERENCE ALIASING:                             │
//  │    CPU reads engine.strokes (live, mutable)              │
//  │    Shadow reads FrameSnapshot (frozen, deep copy)       │
//  │    GPU reads GPUStrokeBuffer (encoded, float32)         │
//  │    → Mid-frame mutation can cause CPU to see different  │
//  │      data than Shadow/GPU.                              │
//  │                                                         │
//  │ 3. PRECISION LOSS:                                      │
//  │    CPU: double-precision JS numbers → Canvas2D          │
//  │    Shadow: double → Float32Array (geometry) → Path2D    │
//  │    GPU: double → Float32Array → GLSL mediump float      │
//  │    → Each conversion loses precision.                   │
//  │                                                         │
//  │ 4. COORDINATE SPACE:                                    │
//  │    CPU: world + camera transform via setTransform()     │
//  │    Shadow: world + camera (same as CPU)                 │
//  │    GPU: world → NDC via vertex shader                   │
//  │    → Different transform chains can accumulate error.   │
//  └─────────────────────────────────────────────────────────┘
//
//  Single-source truth answer:
//  ✅ CPU (main.ts renderFrame output) is the SINGLE truth.
//     Shadow and GPU are validation mirrors, not truth sources.
//     This is NOT multi-consensus — it's anchor + corroboration.
// ============================================================

import type { FrameSnapshot, FrozenStroke } from '../FrameSnapshot';
import type { ShadowRenderOutput } from '../ShadowRenderer';
import type { RenderDiffResult } from '../RenderDiffEngine';
import type { GPUMirrorOutput } from '../gpu/GPUShadowMirror';
import type { RenderAlignmentResult } from '../gpu/GPUAlignmentEngine';
import type { StabilityReport } from '../SVSDiffStabilizer';

// ============================================================
//  Types
// ============================================================

/** 唯一真值来源 — 严格单源 */
export type TruthSource = 'cpu';

/** 统一渲染输出 — 归一化所有三路到共同结构 */
export interface NormalizedRenderOutput {
  source: 'cpu' | 'shadow' | 'gpu';
  frameId: number;
  strokeCount: number;
  strokeIds: string[];
  pointCount: number;
  /** 是否成功渲染（该路无内部错误） */
  renderSuccess: boolean;
}

/** 偏差度量 */
export interface DeviationMetrics {
  /** CPU vs Shadow: max bbox deviation (px) */
  cpuVsShadow: number;
  /** CPU vs GPU: stroke count delta */
  cpuVsGPU: number;
  /** Shadow vs GPU: stroke count delta */
  shadowVsGPU: number;
}

/** 最终帧状态 */
export type FrameFinalStatus = 'green' | 'yellow' | 'red';

/** 真值帧 — 仲裁后的最终输出 */
export interface RenderTruthFrame {
  frameId: number;

  /** 总是 'cpu' */
  truthSource: TruthSource;

  // ── 三路归一化输出 ──
  cpu: NormalizedRenderOutput | null;
  shadow: NormalizedRenderOutput | null;
  gpu: NormalizedRenderOutput | null;

  /** 统一 strokes（来自 CPU anchor 的冻结快照） */
  unifiedStrokes: readonly FrozenStroke[];

  /** 偏差度量 */
  deviationMetrics: DeviationMetrics;

  /** 最终状态 */
  finalStatus: FrameFinalStatus;

  /** 置信度 0~1 */
  confidenceScore: number;
}

/** 仲裁决策 */
export interface ArbitrationDecision {
  /** 是否接受此帧 */
  acceptFrame: boolean;
  /** 推荐数据源（总是 'cpu'） */
  preferredSource: 'cpu';
  /** 决策原因 */
  reason: string;
  /** 是否有数据不一致 */
  hasDataIssue: boolean;
  /** 是否有渲染不一致 */
  hasRenderIssue: boolean;
}

/** 完整仲裁结果 */
export interface RenderTruthResult {
  frameId: number;

  /** 总体状态 */
  status: 'aligned' | 'drifting' | 'unstable';

  /** 真值帧 */
  truth: RenderTruthFrame;

  /** 汇总指标 */
  metrics: {
    maxDeviation: number;
    lossRate: number;
    driftScore: number;
  };

  /** 仲裁决策 */
  decision: ArbitrationDecision;

  /** 原始对齐结果（供调试） */
  _rawAlignment: RenderAlignmentResult | null;
  _rawDiff: RenderDiffResult | null;
  _rawStability: StabilityReport | null;
}

// ============================================================
//  Constants
// ============================================================

/** 状态判定阈值 */
export const ARBITRATION_THRESHOLDS = {
  /** green → yellow: max deviation >= this (px) */
  YELLOW_DEVIATION_PX: 2,
  /** yellow → red: max deviation >= this (px) */
  RED_DEVIATION_PX: 10,
  /** green → yellow: stroke loss rate >= this */
  YELLOW_LOSS_RATE: 0.05,
  /** yellow → red: stroke loss rate >= this */
  RED_LOSS_RATE: 0.3,
  /** green → yellow: confidence < this */
  YELLOW_CONFIDENCE: 0.95,
  /** yellow → red: confidence < this */
  RED_CONFIDENCE: 0.6,
} as const;

// ============================================================
//  Normalize helpers
// ============================================================

/** 从 FrameSnapshot 归一化 CPU 输出 */
export function normalizeCPUOutput(snapshot: FrameSnapshot): NormalizedRenderOutput {
  return {
    source: 'cpu',
    frameId: snapshot.frameId,
    strokeCount: snapshot.strokes.length,
    strokeIds: snapshot.strokes.map(s => s.id),
    pointCount: snapshot.strokes.reduce((s, st) => s + st.points.length, 0)
      + (snapshot.previewStroke?.points.length ?? 0),
    renderSuccess: true, // CPU is always considered successful
  };
}

/** 从 ShadowRenderOutput 归一化 Shadow 输出 */
export function normalizeShadowOutput(
  output: ShadowRenderOutput | null,
  frameId: number,
): NormalizedRenderOutput | null {
  if (!output) return null;
  return {
    source: 'shadow',
    frameId,
    strokeCount: output.strokeCount,
    strokeIds: output.strokeIds,
    pointCount: output.totalPoints,
    renderSuccess: output.renderErrors.length === 0,
  };
}

/** 从 GPUMirrorOutput 归一化 GPU 输出 */
export function normalizeGPUOutput(
  output: GPUMirrorOutput | null,
  frameId: number,
): NormalizedRenderOutput | null {
  if (!output) return null;
  return {
    source: 'gpu',
    frameId,
    strokeCount: output.encoderStats.totalStrokesEncoded,
    strokeIds: [], // GPU encoder doesn't track stroke IDs per frame (aggregate)
    pointCount: output.encoderStats.totalPointsEncoded,
    renderSuccess: output.renderMetrics !== null && output.renderMetrics.webgl2Available,
  };
}

// ============================================================
//  Confidence scoring
// ============================================================

/**
 * 计算仲裁置信度 0~1。
 *
 * 公式:
 *   baseConfidence = 1.0
 *   - 0.15 if Shadow disagrees with CPU on stroke count
 *   - 0.10 if GPU disagrees with CPU on stroke count
 *   - 0.05 per bbox mismatch (max 0.20)
 *   - 0.15 if SVS stability is not 'stable'
 *   - 0.10 if GPU stroke loss > 0
 *
 * 最小值 = 0.3（不会降到 0 — CPU 总是存在）
 */
export function computeConfidence(
  cpuVsShadow: RenderDiffResult | null,
  alignment: RenderAlignmentResult | null,
  stability: StabilityReport | null,
): number {
  let confidence = 1.0;

  // Shadow disagreement
  if (cpuVsShadow && !cpuVsShadow.isClean) {
    confidence -= 0.15;
    const bboxPenalty = Math.min(0.20, cpuVsShadow.bboxMismatches.length * 0.05);
    confidence -= bboxPenalty;
  }

  // GPU disagreement
  if (alignment && !alignment.isAligned) {
    confidence -= 0.10;
    if (alignment.metrics.strokeLossRate > 0) {
      confidence -= 0.10;
    }
  }

  // SVS stability
  if (stability && stability.state !== 'stable') {
    confidence -= 0.15;
  }

  return Math.max(0.3, Math.min(1.0, confidence));
}

/**
 * 根据偏差计算最终状态。
 */
export function computeStatus(
  maxDeviation: number,
  lossRate: number,
  confidence: number,
): FrameFinalStatus {
  if (maxDeviation >= ARBITRATION_THRESHOLDS.RED_DEVIATION_PX) return 'red';
  if (lossRate >= ARBITRATION_THRESHOLDS.RED_LOSS_RATE) return 'red';
  if (confidence < ARBITRATION_THRESHOLDS.RED_CONFIDENCE) return 'red';

  if (maxDeviation >= ARBITRATION_THRESHOLDS.YELLOW_DEVIATION_PX) return 'yellow';
  if (lossRate >= ARBITRATION_THRESHOLDS.YELLOW_LOSS_RATE) return 'yellow';
  if (confidence < ARBITRATION_THRESHOLDS.YELLOW_CONFIDENCE) return 'yellow';

  return 'green';
}

// ============================================================
//  Critical Insight Documentation
// ============================================================

/**
 * ## Why CPU is the single truth:
 *
 * 1. PRODUCTION: CPU render is what the user sees. If CPU is "wrong",
 *    the system is wrong. There is no higher authority.
 *
 * 2. CANONICAL DATA: engine.strokes IS the data. CPU reads it directly.
 *    Shadow/GPU read copies. The original is the truth.
 *
 * 3. SIMPLICITY: Path2D.stroke() is the simplest, most battle-tested
 *    Canvas2D operation. It has no encoding loss, no shader precision issues.
 *
 * 4. AUTHORITY: main.ts is the only path that writes to storage.
 *    What gets saved = what CPU rendered. Consistency with storage = truth.
 *
 * ## Why GPU cannot be truth:
 *
 * 1. APPROXIMATION: GPU uses circle stamping to approximate curves.
 *    It is fundamentally a different visual model.
 *
 * 2. PRECISION: GPU shaders use mediump float (10-bit mantissa).
 *    World-space coordinates can exceed representable range at high zoom.
 *
 * 3. LIFECYCLE: GPU context can be lost. CPU Canvas2D context is stable.
 *
 * ## Shadow's role: validator, not truth:
 *
 * Shadow uses StrokeGeometryEngine — a DIFFERENT geometry algorithm —
 * to verify that engine.strokes data is self-consistent. If Shadow agrees
 * with CPU, we have high confidence the data pipeline is clean. If Shadow
 * disagrees, we have evidence of a data problem (not a rendering problem).
 *
 * ## Single-source truth vs multi-consensus:
 *
 * Multi-consensus (voting) is wrong here because:
 * - The three systems use DIFFERENT algorithms on the SAME data
 * - They CANNOT produce identical output by design
 * - Voting would penalize correct-but-different results
 *
 * Single-source with corroboration is correct:
 * - CPU is always right (anchor)
 * - Shadow/GPU provide confidence (corroboration)
 * - Disagreement = investigation trigger, not truth override
 */

// ============================================================
//  Does main.ts need refactoring?
//
//  Answer: NO.
//
//  Reason: The Arbitration Layer is purely a convergence layer ABOVE
//  the three rendering systems. It reads their outputs, computes
//  consistency metrics, and produces a truth frame. It does not:
//  - Modify rendering logic
//  - Change data flow
//  - Replace any existing component
//
//  The only integration needed is a single hook call in
//  _unifiedTick() after all three renders complete — same pattern
//  already established by ShadowSessionHook.
// ============================================================
