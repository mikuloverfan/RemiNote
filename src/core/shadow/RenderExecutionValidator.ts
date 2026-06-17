// ============================================================
//  Render Execution Validator — Tap + Trace 融合验证
//
//  职责：
//  ✔ 融合 RenderGroundTruthTap 和 ExecutionTraceHook 的输出
//  ✔ 三层交叉验证：intent (renderQueue) vs data (snapshot) vs execution (ctx calls)
//  ✔ 检测三者的任何不一致
//  ✔ consistencyScore 0~1 量化执行一致性
//
//  三层含义：
//    SNAPSHOT 层 = "数据说应该渲染什么"
//    RENDERQUEUE 层 = "CPU 打算渲染什么"（Tap 捕获）
//    EXECUTION 层 = "Canvas 实际执行了什么"（Trace 捕获）
//
//  如果三层一致 → 渲染管线正确
//  如果任何层不一致 → 存在 bug
//
//  约束：
//  ❌ 不修改任何现有模块
//  ✅ 纯消费 — 读 Tap + Trace 输出
// ============================================================

import type { RenderTapOutput, RenderVsSnapshotDiff } from './RenderGroundTruthTap';
import type { CanvasExecutionTrace } from './ExecutionTraceHook';

// ============================================================
//  Types
// ============================================================

export type ValidationStatus = 'valid' | 'suspicious' | 'invalid';

export interface RenderExecutionValidation {
  frameId: number;

  // ── 子验证 ──
  renderVsSnapshot: RenderVsSnapshotDiff | null;
  executionTrace: CanvasExecutionTrace | null;

  // ── 交叉验证 ──
  /** renderQueue 声称的 stroke 数 vs canvas 实际 stroke() 调用数 */
  intentVsExecution: {
    /** renderQueue 中的 stroke 条目数 */
    intentStrokeCount: number;
    /** ctx.stroke() 实际调用次数 */
    executionStrokeCount: number;
    /** 是否匹配 */
    match: boolean;
    /** 差异 */
    delta: number;
  };

  // ── 综合评分 ──
  consistencyScore: number;
  status: ValidationStatus;

  // ── 诊断 ──
  /** 被渲染但从未出现在 snapshot 中的 stroke（可能是 ghost stroke） */
  suspectedGhostStrokes: string[];
  /** 被渲染但 draw call 数不匹配 */
  suspectedDroppedStrokes: string[];

  /** 人类可读的诊断信息 */
  diagnosticMessage: string;
}

// ============================================================
//  RenderExecutionValidator
// ============================================================

export class RenderExecutionValidator {
  private _enabled = false;
  private _lastValidation: RenderExecutionValidation | null = null;

  enable(): void { this._enabled = true; }
  disable(): void { this._enabled = false; }
  get enabled(): boolean { return this._enabled; }

  // ==========================================================
  //  validate — 融合验证入口
  // ==========================================================

  /**
   * 融合 Tap 和 Trace 输出，产生执行一致性验证。
   *
   * @param renderVsSnapshot  RenderGroundTruthTap.verify() 的输出
   * @param tapOutput         RenderGroundTruthTap.capture() 的输出
   * @param trace             ExecutionTraceHook.endFrame() 的输出
   * @returns                 融合验证结果
   */
  validate(
    renderVsSnapshot: RenderVsSnapshotDiff | null,
    tapOutput: RenderTapOutput | null,
    trace: CanvasExecutionTrace | null,
  ): RenderExecutionValidation {
    const frameId = tapOutput?.frameId ?? trace?.frameId ?? 0;

    // ── Intent vs Execution ──
    const intentStrokeCount = tapOutput?.renderedStrokeCount ?? 0;
    const executionStrokeCount = trace?.counts?.stroke ?? 0;
    const intentVsExecutionMatch = intentStrokeCount === executionStrokeCount;

    // ── Ghost stroke detection ──
    const suspectedGhostStrokes: string[] = [];
    if (renderVsSnapshot && renderVsSnapshot.extraInRender.length > 0) {
      suspectedGhostStrokes.push(...renderVsSnapshot.extraInRender);
    }

    // ── Dropped stroke detection ──
    const suspectedDroppedStrokes: string[] = [];
    if (renderVsSnapshot && renderVsSnapshot.missingFromRender.length > 0) {
      suspectedDroppedStrokes.push(...renderVsSnapshot.missingFromRender);
    }

    // ── Consistency score ──
    let score = 1.0;

    // Penalty 1: render vs snapshot mismatch
    if (renderVsSnapshot && !renderVsSnapshot.consistent) {
      score -= 0.30;
      if (renderVsSnapshot.missingFromRender.length > 0) score -= 0.10;
      if (renderVsSnapshot.extraInRender.length > 0) score -= 0.10;
      if (!renderVsSnapshot.orderMatch) score -= 0.05;
    }

    // Penalty 2: intent vs execution mismatch
    if (!intentVsExecutionMatch) {
      score -= 0.20;
      score -= Math.min(0.10, Math.abs(intentStrokeCount - executionStrokeCount) * 0.02);
    }

    // Penalty 3: zero execution calls (likely trace disabled or crashed)
    if (trace && trace.counts.total === 0 && tapOutput && tapOutput.renderedStrokeCount > 0) {
      score -= 0.15;
    }

    score = Math.max(0, Math.min(1, score));

    // ── Status ──
    let status: ValidationStatus;
    if (score >= 0.95) status = 'valid';
    else if (score >= 0.6) status = 'suspicious';
    else status = 'invalid';

    // ── Diagnostic message ──
    const parts: string[] = [];
    if (renderVsSnapshot && !renderVsSnapshot.consistent) {
      parts.push(`render≠snapshot: ${renderVsSnapshot.missingFromRender.length} missing, ${renderVsSnapshot.extraInRender.length} extra`);
    }
    if (!intentVsExecutionMatch) {
      parts.push(`intent≠exec: renderQueue=${intentStrokeCount} vs stroke()=${executionStrokeCount}`);
    }
    if (suspectedGhostStrokes.length > 0) {
      parts.push(`ghost strokes: ${suspectedGhostStrokes.join(',')}`);
    }
    if (parts.length === 0) parts.push('all layers consistent');

    // ── Result ──
    const result: RenderExecutionValidation = {
      frameId,
      renderVsSnapshot,
      executionTrace: trace,
      intentVsExecution: {
        intentStrokeCount,
        executionStrokeCount,
        match: intentVsExecutionMatch,
        delta: intentStrokeCount - executionStrokeCount,
      },
      consistencyScore: score,
      status,
      suspectedGhostStrokes,
      suspectedDroppedStrokes,
      diagnosticMessage: parts.join('; '),
    };

    this._lastValidation = result;
    return result;
  }

  get lastValidation(): RenderExecutionValidation | null {
    return this._lastValidation;
  }
}

export default RenderExecutionValidator;
