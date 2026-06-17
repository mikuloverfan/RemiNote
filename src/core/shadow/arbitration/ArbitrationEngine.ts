// ============================================================
//  Final Render Arbitration Layer — ArbitrationEngine
//
//  职责：
//  ✔ 消费三路输出 → 仲裁 → 输出单一 RenderTruthResult
//  ✔ 确定性冲突解决 — CPU anchor, never overruled
//  ✔ 置信度评分 — 0~1 连续值
//  ✔ Frame status — green / yellow / red
//
//  仲裁规则（确定性，按优先级）：
//
//  Rule 1 — CPU ANCHOR:
//    CPU 输出永远被接受。CPU renderSuccess = true 意味着帧被接受。
//    没有系统可以 "overrule" CPU。
//
//  Rule 2 — SHADOW CORROBORATION:
//    如果 Shadow.strokeCount === CPU.strokeCount && diff.isClean:
//      → confidence ↑ (data pipeline verified)
//    如果 Shadow disagrees:
//      → 检查 SVSFrameLocker.corruptedFrames
//      → 如果 frame corrupted → CPU data 可能有 mid-frame mutation → yellow
//      → 如果 frame clean → Shadow 可能有几何算法偏差 → yellow (low severity)
//
//  Rule 3 — GPU VERIFICATION:
//    如果 GPU.strokeCount === CPU.strokeCount:
//      → GPU encoding pipeline verified → confidence ↑
//    如果 GPU disagrees:
//      → strokeLossRate > 0 → GPU encoding bug → yellow
//      → strokeLossRate > 0.3 → GPU pipeline broken → red
//
//  Rule 4 — GEOMETRY DRIFT:
//    如果 maxBBoxDeviation < 2px:
//      → green (normal precision loss)
//    如果 2px ≤ maxBBoxDeviation < 10px:
//      → yellow (significant but not critical)
//    如果 maxBBoxDeviation ≥ 10px:
//      → red (data corruption likely)
//
//  Rule 5 — CONFIDENCE FLOOR:
//    confidence 永不低于 0.3 (CPU 总是存在)
//    confidence ≥ 0.95 → green
//    0.60 ≤ confidence < 0.95 → yellow
//    confidence < 0.60 → red
//
//  Rule 6 — NO AUTO RERENDER:
//    仲裁层只报告，不触发任何 re-render。
//    不修改任何渲染状态。
//    不回调任何渲染函数。
//
//  约束：
//  ❌ 不修改 main.ts
//  ❌ 不修改 SVS / GPU pipeline
//  ❌ 不触发 re-render
//  ✅ 纯仲裁 — 读输入 → 算 → 输出
// ============================================================

import type { FrameSnapshot } from '../FrameSnapshot';
import type { ShadowRenderOutput } from '../ShadowRenderer';
import type { RenderDiffResult } from '../RenderDiffEngine';
import type { GPUMirrorOutput } from '../gpu/GPUShadowMirror';
import type { RenderAlignmentResult } from '../gpu/GPUAlignmentEngine';
import type { StabilityReport } from '../SVSDiffStabilizer';
import type { SVSFrameLocker } from '../SVSFrameLocker';

import {
  normalizeCPUOutput,
  normalizeShadowOutput,
  normalizeGPUOutput,
  computeConfidence,
  computeStatus,
  type RenderTruthFrame,
  type RenderTruthResult,
  type ArbitrationDecision,
  type NormalizedRenderOutput,
  type DeviationMetrics,
} from './RenderTruthModel';

// ============================================================
//  Types
// ============================================================

export interface ArbitrationInput {
  /** SVS 帧快照 (ground truth data) */
  snapshot: FrameSnapshot;
  /** Shadow 渲染输出 */
  shadowOutput: ShadowRenderOutput | null;
  /** GPU 镜像输出 */
  gpuOutput: GPUMirrorOutput | null;
  /** CPU vs Shadow diff */
  diff: RenderDiffResult | null;
  /** 三路对齐结果 */
  alignment: RenderAlignmentResult | null;
  /** SVS 稳定性报告 */
  stability: StabilityReport | null;
  /** FrameLocker 实例 (读 corruption 状态) */
  frameLocker: SVSFrameLocker | null;
}

export interface ArbitrationConfig {
  debug?: boolean;
}

// ============================================================
//  ArbitrationEngine
// ============================================================

export class ArbitrationEngine {
  private _enabled = false;
  private _debug = false;
  private _lastResult: RenderTruthResult | null = null;
  private _totalArbitrations = 0;

  // ── 累积统计 ──
  private _greenCount = 0;
  private _yellowCount = 0;
  private _redCount = 0;

  constructor(config: ArbitrationConfig = {}) {
    this._debug = config.debug ?? false;
  }

  // ==========================================================
  //  Lifecycle
  // ==========================================================

  enable(): void { this._enabled = true; }
  disable(): void { this._enabled = false; }
  get enabled(): boolean { return this._enabled; }

  // ==========================================================
  //  arbitrate — 主仲裁入口
  // ==========================================================

  /**
   * 仲裁一帧的三路渲染输出。
   *
   * 输入: 三路输出 + diff + alignment + stability
   * 输出: 单一 RenderTruthResult
   *
   * 🔒 所有异常在 try/catch 内隔离，永远返回结果。
   */
  arbitrate(input: ArbitrationInput): RenderTruthResult {
    this._totalArbitrations++;

    try {
      return this._arbitrateInternal(input);
    } catch (err) {
      if (this._debug) {
        console.error('[Arbitration] ❌ arbitrate crashed:', err);
      }
      return this._emptyResult(input.snapshot.frameId);
    }
  }

  // ==========================================================
  //  Query
  // ==========================================================

  get lastResult(): RenderTruthResult | null { return this._lastResult; }
  get totalArbitrations(): number { return this._totalArbitrations; }
  get greenCount(): number { return this._greenCount; }
  get yellowCount(): number { return this._yellowCount; }
  get redCount(): number { return this._redCount; }

  /** 获取健康度: green / total */
  get healthRatio(): number {
    return this._totalArbitrations > 0
      ? this._greenCount / this._totalArbitrations
      : 0;
  }

  // ==========================================================
  //  Private: arbitration logic
  // ==========================================================

  private _arbitrateInternal(input: ArbitrationInput): RenderTruthResult {
    const { snapshot, shadowOutput, gpuOutput, diff, alignment, stability, frameLocker } = input;
    const frameId = snapshot.frameId;

    // ── Step 1: Normalize all three outputs ──
    const cpu = normalizeCPUOutput(snapshot);
    const shadow = normalizeShadowOutput(shadowOutput, frameId);
    const gpu = normalizeGPUOutput(gpuOutput, frameId);

    // ── Step 2: Compute deviation metrics ──
    const deviationMetrics = this._computeDeviations(cpu, shadow, gpu, diff, alignment);

    // ── Step 3: Compute confidence ──
    const confidence = computeConfidence(diff, alignment, stability);

    // ── Step 4: Compute status ──
    const finalStatus = computeStatus(
      deviationMetrics.cpuVsShadow,
      alignment?.metrics.strokeLossRate ?? 0,
      confidence,
    );

    // ── Step 5: Build truth frame ──
    const truthFrame: RenderTruthFrame = {
      frameId,
      truthSource: 'cpu',
      cpu,
      shadow,
      gpu,
      unifiedStrokes: snapshot.strokes,
      deviationMetrics,
      finalStatus,
      confidenceScore: confidence,
    };

    // ── Step 6: Arbitration decision ──
    const decision = this._makeDecision(
      finalStatus,
      confidence,
      cpu,
      shadow,
      gpu,
      diff,
      alignment,
      frameLocker,
    );

    // ── Step 7: Overall status ──
    const overallStatus = this._computeOverallStatus(finalStatus, alignment, stability);

    // ── Step 8: Build result ──
    const result: RenderTruthResult = {
      frameId,
      status: overallStatus,
      truth: truthFrame,
      metrics: {
        maxDeviation: deviationMetrics.cpuVsShadow,
        lossRate: alignment?.metrics.strokeLossRate ?? 0,
        driftScore: alignment?.metrics.gpuDrift ?? 0,
      },
      decision,
      _rawAlignment: alignment,
      _rawDiff: diff,
      _rawStability: stability,
    };

    // Track stats
    if (finalStatus === 'green') this._greenCount++;
    else if (finalStatus === 'yellow') this._yellowCount++;
    else this._redCount++;

    this._lastResult = result;

    if (this._debug && finalStatus !== 'green') {
      console.warn('[Arbitration] ⚠️ non-green frame:', {
        frameId,
        status: finalStatus,
        confidence: confidence.toFixed(3),
        maxDeviation: deviationMetrics.cpuVsShadow.toFixed(2),
        decision: decision.reason,
      });
    }

    return result;
  }

  // ==========================================================
  //  Private: deviation computation
  // ==========================================================

  private _computeDeviations(
    cpu: NormalizedRenderOutput,
    shadow: NormalizedRenderOutput | null,
    gpu: NormalizedRenderOutput | null,
    diff: RenderDiffResult | null,
    alignment: RenderAlignmentResult | null,
  ): DeviationMetrics {
    return {
      cpuVsShadow: diff?.bboxMismatches.reduce(
        (max, m) => Math.max(max, m.deltaMinX, m.deltaMinY, m.deltaMaxX, m.deltaMaxY),
        0,
      ) ?? 0,
      cpuVsGPU: alignment?.metrics.cpuVsGPUCountDelta ?? (cpu.strokeCount - (gpu?.strokeCount ?? 0)),
      shadowVsGPU: (shadow?.strokeCount ?? 0) - (gpu?.strokeCount ?? 0),
    };
  }

  // ==========================================================
  //  Private: decision making (deterministic)
  // ==========================================================

  private _makeDecision(
    status: 'green' | 'yellow' | 'red',
    confidence: number,
    cpu: NormalizedRenderOutput,
    shadow: NormalizedRenderOutput | null,
    gpu: NormalizedRenderOutput | null,
    diff: RenderDiffResult | null,
    alignment: RenderAlignmentResult | null,
    frameLocker: SVSFrameLocker | null,
  ): ArbitrationDecision {
    const reasons: string[] = [];
    let hasDataIssue = false;
    let hasRenderIssue = false;

    // Rule 1: CPU anchor — always accept
    const acceptFrame = cpu.renderSuccess;

    // Rule 2: Shadow corroboration check
    if (shadow && diff) {
      if (!diff.isClean) {
        hasDataIssue = true;
        if (frameLocker && frameLocker.corruptionRate > 0) {
          reasons.push(`Shadow disagrees; frame corruption detected (rate: ${frameLocker.corruptionRate.toFixed(3)})`);
        } else {
          reasons.push(`Shadow disagrees: ${diff.missingStrokes.length} missing, ${diff.extraStrokes.length} extra, ${diff.bboxMismatches.length} bbox mismatches`);
        }
      }
    }

    // Rule 3: GPU verification check
    if (gpu && alignment) {
      if (!alignment.metrics.strokeLossRate || alignment.metrics.strokeLossRate > 0) {
        hasRenderIssue = true;
        reasons.push(`GPU stroke loss rate: ${(alignment.metrics.strokeLossRate * 100).toFixed(1)}%`);
      }
      if (alignment.metrics.gpuDrift > 0) {
        reasons.push(`GPU frame drift: ${alignment.metrics.gpuDrift}`);
      }
    }

    // Rule 4: Confidence degradation reason
    if (status !== 'green') {
      reasons.push(`Confidence ${(confidence * 100).toFixed(0)}% — ${status}`);
    }

    // Build reason string
    const reason = reasons.length > 0
      ? reasons.join('; ')
      : `All systems aligned (confidence: ${(confidence * 100).toFixed(0)}%)`;

    return {
      acceptFrame,
      preferredSource: 'cpu',
      reason,
      hasDataIssue,
      hasRenderIssue,
    };
  }

  // ==========================================================
  //  Private: overall status
  // ==========================================================

  private _computeOverallStatus(
    frameStatus: 'green' | 'yellow' | 'red',
    alignment: RenderAlignmentResult | null,
    stability: StabilityReport | null,
  ): 'aligned' | 'drifting' | 'unstable' {
    if (frameStatus === 'green') return 'aligned';

    if (frameStatus === 'red') return 'unstable';

    // Yellow — check stability context
    if (stability && stability.state === 'alert') return 'unstable';
    if (stability && stability.state === 'degrading') return 'drifting';

    return 'drifting';
  }

  // ==========================================================
  //  Private: empty fallback
  // ==========================================================

  private _emptyResult(frameId: number): RenderTruthResult {
    return {
      frameId,
      status: 'unstable',
      truth: {
        frameId,
        truthSource: 'cpu',
        cpu: null,
        shadow: null,
        gpu: null,
        unifiedStrokes: [],
        deviationMetrics: { cpuVsShadow: 0, cpuVsGPU: 0, shadowVsGPU: 0 },
        finalStatus: 'red',
        confidenceScore: 0.3,
      },
      metrics: { maxDeviation: 0, lossRate: 1, driftScore: 999 },
      decision: {
        acceptFrame: false,
        preferredSource: 'cpu',
        reason: 'Arbitration engine crashed',
        hasDataIssue: true,
        hasRenderIssue: true,
      },
      _rawAlignment: null,
      _rawDiff: null,
      _rawStability: null,
    };
  }
}

export default ArbitrationEngine;
