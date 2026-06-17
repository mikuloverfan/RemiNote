// ============================================================
//  Phase 5.5.1: Brush Kernel — spec-driven CPU/GPU evaluator
//
//  核心原则：
//  🎯 笔刷成为"数据"（BrushKernelSpec），不再是"函数"
//  🎯 CPU/GPU 完全同构 — 相同 spec → 相同输出
//
//  架构：
//    Brush → specFromBrush() → BrushKernelSpec
//    RenderCommand → evaluateCPU(spec, input) → { inkW, opacity, radius }
//
//  收益：
//  ✔ 笔刷 = 数据（可序列化，可 GPU 映射）
//  ✔ GPU shader 可直接从 spec 生成
//  ✔ 不再 JS-only 函数调用
//
//  约束：
//  ❌ 不修改现有 brush kernel（addPoint 中 inkW 计算不变）
//  ❌ 纯函数 — 相同输入永远相同输出
//  ✅ CPU fallback = spec-driven 纯函数
// ============================================================

import type { Brush } from './BrushModel';
import type { BrushKernelSpec, SpecEvalInput, SpecEvalOutput } from './BrushKernelSpec';
import { evaluateCPU, specFromBrush, DEFAULT_SPEC } from './BrushKernelSpec';

// Re-export for convenience
export type { BrushKernelSpec, SpecEvalInput, SpecEvalOutput } from './BrushKernelSpec';
export { evaluateCPU, specFromBrush, DEFAULT_SPEC } from './BrushKernelSpec';

// ============================================================
//  Types — backward-compatible aliases
// ============================================================

/** @deprecated Use SpecEvalInput from BrushKernelSpec */
export type BrushKernelInput = SpecEvalInput;

/** @deprecated Use SpecEvalOutput from BrushKernelSpec */
export type BrushKernelOutput = SpecEvalOutput;

// ============================================================
//  BrushKernel — spec-driven 统一笔刷核心
// ============================================================

export class BrushKernel {
  /**
   * 评估笔刷核心 — spec-driven，CPU/GPU 同构。
   *
   * 委托到 evaluateCPU(spec, input, brush)。
   * 相同 input + spec + brush → 永远相同输出（纯函数）。
   *
   * @param input  笔刷输入（pressure, velocity, t, totalLen?）
   * @param brush  笔刷配置（size）
   * @param spec   笔刷规格（可选，默认从 brush 推导）
   * @returns      渲染参数 { inkW, opacity, radius }
   */
  static evaluate(
    input: SpecEvalInput,
    brush: Pick<Brush, 'size'>,
    spec?: BrushKernelSpec,
  ): SpecEvalOutput {
    const resolvedSpec = spec ?? specFromBrush(brush as Readonly<Brush>);
    return evaluateCPU(input, resolvedSpec, brush);
  }
}
