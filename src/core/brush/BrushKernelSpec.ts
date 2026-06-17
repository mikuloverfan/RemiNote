// ============================================================
//  Phase 5.5.1: Brush Kernel Spec — GPU/CPU 双可编译描述
//
//  核心思想：
//  🎯 不再"写函数"，而是"定义笔刷语言"
//  🎯 BrushKernelSpec = 纯数据描述，不是代码
//  🎯 CPU/GPU 完全同构 — 相同 spec → 相同输出
//
//  架构变化：
//    Before: JS function brush → inkW → draw
//    After:  BrushSpec → evaluateCPU / evaluateGPU → draw
//
//  收益：
//  ✔ 笔刷成为"数据" — 不是代码
//  ✔ GPU 可直接生成 shader（GLSL/WebGPU）
//  ✔ 同一 spec 驱动 CPU 和 GPU 评估
//  ✔ 真正进入"PS 级 brush simulation engine"
//
//  约束：
//  ✔ Spec 不包含任何 JS 运行时逻辑
//  ✔ Spec 纯数据 — 可序列化，可 GPU 映射
//  ✔ CPU fallback = spec-driven 纯函数
// ============================================================

import type { Brush, WidthProfile } from './BrushModel';
import LogManager from '../debug/LogManager';

// ============================================================
//  Types
// ============================================================

/**
 * BrushKernelSpec — 笔刷核心规格（纯数据描述）。
 *
 * 这是一份 GPU-compatible 的描述结构。
 * CPU 和 GPU 使用相同 spec 计算相同结果。
 *
 * GLSL 等价映射：
 *   float P = pow(pressure, pressureCurve);
 *   float V = 1.0 / (1.0 + velocity * velocityFactor);
 *   float E = easeWidthProfile(t, totalLen, profile, taperStart, taperEnd);
 *   float inkW = brushSize * P * V * E;
 */
export interface BrushKernelSpec {
  /** 压力曲线指数 — 1.0=线性，>1=重压才宽（PS 默认 1.6） */
  pressureCurve: number;
  /** 速度因子强度 — 4=默认，越大速度影响越强 */
  velocityFactor: number;
  /** ⭐ 宽度曲线类型（替换旧的固定 envelopeSize） */
  widthProfile: WidthProfile;
  /** ⭐ 起笔 taper 强度 0~1 */
  taperStart: number;
  /** ⭐ 收笔 taper 强度 0~1 */
  taperEnd: number;
  /** ⭐ 墨水流体感 0~1 — 0=即时响应, 1=宽度带惯性滞后 */
  flow: number;
  /** 不透明度柔和度 — 1=线性，>1=更透明 */
  opacityCurve: number;
  /** 笔尖硬度 0~1 — 0=柔和, 1=锐利，映射到边缘羽化半径 */
  tipHardness: number;
}

// ============================================================
//  Spec 输入（评估所需的所有参数）
// ============================================================

/** BrushKernelSpec 评估输入 */
export interface SpecEvalInput {
  /** 规范化压力 0~1 */
  pressure: number;
  /** 规范化速度 0~1 */
  velocity: number;
  /** 距笔触起点的累积距离（世界坐标 px） */
  t: number;
  /** 笔触总长度（世界坐标 px）。未提供时仅应用起笔淡入。 */
  totalLen?: number;
}

/** BrushKernelSpec 评估输出 */
export interface SpecEvalOutput {
  /** ink width（世界坐标 px） */
  inkW: number;
  /** stamp 不透明度 */
  opacity: number;
  /** stamp 半径 */
  radius: number;
  /** ⭐ 边缘羽化半径 (px) — 基于 tipHardness */
  edgeBlur: number;
}

// ============================================================
//  Width Profile 宽度曲线函数
// ============================================================

/**
 * 计算宽度曲线的 envelope 值 (0~1)。
 *
 * 不同的 profile 模拟不同的物理笔触：
 * - 'brush'  : sin eased — 毛笔感，起笔缓、收笔自然
 * - 'pen'    : pow 0.5 — 钢笔感，快速全宽、收笔细尾
 * - 'pencil' : near-instant — 铅笔感，几乎无 taper
 * - 'marker' : quadratic — 马克笔，收笔拖尾
 *
 * @param t 当前点在笔画中的位置 (0 = 起点, totalLen = 终点)
 * @param totalLen 笔画总长度
 * @param profile 宽度曲线类型
 * @param taperStart 起笔强度 (0~1)
 * @param taperEnd 收笔强度 (0~1)
 * @returns envelope 值 0~1
 */
function easeWidthProfile(
  t: number,
  totalLen: number,
  profile: WidthProfile,
  taperStart: number,
  taperEnd: number,
): number {
  if (totalLen <= 0) return 1;

  // 自适应 envelope 长度：至少 3px，最多 40px，但不超过总长 20%
  const maxEnv = Math.max(3, Math.min(40, totalLen * 0.2));
  const startLen = maxEnv * taperStart;
  const endLen = maxEnv * taperEnd;

  // 起笔 envelope
  let startEase = 1;
  if (startLen > 0 && t < startLen) {
    const x = t / startLen; // 0..1
    switch (profile) {
      case 'brush':
        // sin eased: 起笔缓慢渐变（模拟毛笔顿笔）
        startEase = Math.sin(x * Math.PI / 2) ** 0.7;
        break;
      case 'pen':
        // fast ramp: 快速达到全宽
        startEase = Math.pow(x, 0.4);
        break;
      case 'pencil':
        // near-instant: 几乎瞬达
        startEase = x < 0.05 ? 0 : 1;
        break;
      case 'marker':
        // quadratic ease-out: 起笔快但有渐变
        startEase = 1 - Math.pow(1 - x, 2);
        break;
      default:
        startEase = Math.sin(x * Math.PI / 2);
    }
  }

  // 收笔 envelope
  let endEase = 1;
  if (endLen > 0 && t > totalLen - endLen) {
    const x = (totalLen - t) / endLen; // 0..1 from end
    switch (profile) {
      case 'brush':
        // 毛笔收笔：先保持后渐细（模拟笔锋）
        endEase = x < 0.3 ? 1 : Math.sin(x * Math.PI / 2) ** 0.8;
        break;
      case 'pen':
        // 钢笔收笔：快速收细尾
        endEase = Math.pow(x, 0.5);
        break;
      case 'pencil':
        // 铅笔收笔：几乎无变化
        endEase = 1;
        break;
      case 'marker':
        // 马克笔收笔：缓慢渐变（墨水渗透感）
        endEase = 1 - Math.pow(1 - x, 1.5);
        break;
      default:
        endEase = Math.sin(x * Math.PI / 2);
    }
  }

  return startEase * endEase;
}

// ============================================================
//  Default Spec
// ============================================================

/** 默认笔刷规格 — 匹配当前 PS 默认笔刷行为 */
export const DEFAULT_SPEC: BrushKernelSpec = {
  pressureCurve: 1.6,
  velocityFactor: 1.5,
  widthProfile: 'pen',
  taperStart: 0.5,
  taperEnd: 0.5,
  flow: 0,
  opacityCurve: 1,
  tipHardness: 0.3,
};

// ============================================================
//  Spec Factory — Brush → BrushKernelSpec
// ============================================================

/**
 * 从 Brush 配置创建 BrushKernelSpec。
 *
 * 映射规则：
 *   pressureCurve  = brush.pressureCurve
 *   velocityFactor = 2 + brush.velocitySensitivity * 8  (range 2~10)
 *   widthProfile   = brush.widthProfile
 *   taperStart     = brush.taperStart
 *   taperEnd       = brush.taperEnd
 *   flow           = brush.flow
 *   opacityCurve   = 0.5 + brush.hardness * 1.5  (range 0.5~2)
 *   tipHardness    = brush.hardness
 *
 * @param brush 笔刷配置
 * @returns     对应的 BrushKernelSpec
 */
export function specFromBrush(brush: Readonly<Brush>): BrushKernelSpec {
  return {
    pressureCurve: brush.pressureCurve,
    velocityFactor: 2 + brush.velocitySensitivity * 8,
    widthProfile: brush.widthProfile,
    taperStart: brush.taperStart,
    taperEnd: brush.taperEnd,
    flow: brush.flow,
    opacityCurve: 0.5 + brush.hardness * 1.5,
    tipHardness: brush.hardness,
  };
}

// ============================================================
//  Helpers
// ============================================================

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ============================================================
//  evaluateCPU — CPU 评估器（spec-driven）
// ============================================================

/**
 * CPU 评估器 — 从 spec + input + brush 计算渲染参数。
 *
 * 统一公式（CPU & GPU 共享）：
 *   P = pow(p, spec.pressureCurve)
 *   V = 1 / (1 + v * spec.velocityFactor)
 *   E = easeWidthProfile(t, totalLen, spec.widthProfile, spec.taperStart, spec.taperEnd)
 *   inkW = brush.size * P * V * E
 *   opacity = P * (1 - spec.tipHardness * 0.3)
 *   radius = max(0.3, inkW * 0.4)
 *   edgeBlur = (1 - spec.tipHardness) * 3  // 边缘羽化
 *
 * 纯函数 — 相同输入永远相同输出。
 *
 * GLSL 等价结构（预留）：
 *   float P = pow(pressure, pressureCurve);
 *   float V = 1.0 / (1.0 + velocity * velocityFactor);
 *   float E = easeWidthProfile(t, totalLen, profile, taperStart, taperEnd);
 *   float inkW = brushSize * P * V * E;
 *
 * @param input  笔刷评估输入（含 t, totalLen 等）
 * @param spec   笔刷规格
 * @param brush  笔刷配置（仅需 size 字段）
 * @returns      渲染参数 { inkW, opacity, radius, edgeBlur }
 */
export function evaluateCPU(
  input: SpecEvalInput,
  spec: BrushKernelSpec,
  brush: Pick<Brush, 'size'>,
): SpecEvalOutput {
  // Pressure curve
  const P = Math.pow(Math.max(0, Math.min(1, input.pressure)), spec.pressureCurve);

  // Velocity curve
  const V = 1 / (1 + input.velocity * spec.velocityFactor);

  // ⭐ Width profile envelope (replaces fixed smoothstep)
  const totalLen = input.totalLen;
  const E = (totalLen != null && totalLen > 0)
    ? easeWidthProfile(input.t, totalLen, spec.widthProfile, spec.taperStart, spec.taperEnd)
    : 1;

  // Final ink width
  const inkW = Math.max(0.1, brush.size * P * V * E);

  // Derived values
  const opacity = P * (1 - spec.tipHardness * 0.3);
  const radius = Math.max(0.8, inkW * 1.2);
  // ⭐ Edge blur: tipHardness=0 → 3px blur, tipHardness=1 → 0px blur (hard edge)
  const edgeBlur = (1 - spec.tipHardness) * 3;

  return { inkW, opacity, radius, edgeBlur };
}

// ============================================================
//  Ink Flow — 墨水滞后效应
// ============================================================

/**
 * 对宽度序列施加墨水滞后效果。
 * 模拟真实墨水在纸上的"惯性"——起笔处墨多，快速移动时墨跟不上。
 *
 * @param widths 原始宽度数组
 * @param flow 流动强度 0~1 (0=无滞后，1=强滞后)
 * @returns 滞后处理后的宽度数组
 */
export function applyInkFlow(widths: number[], flow: number): number[] {
  if (flow <= 0 || widths.length < 2) return widths;

  const result: number[] = [widths[0]];
  // flow 决定平滑系数：flow=0 时不滞后，flow=1 时强滞后
  const alpha = 1 - flow * 0.4; // 0.6~1.0

  for (let i = 1; i < widths.length; i++) {
    // 指数移动平均：当前值受前一个值影响
    result[i] = result[i - 1] + (widths[i] - result[i - 1]) * alpha;
  }

  return result;
}
