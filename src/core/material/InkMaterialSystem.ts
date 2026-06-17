// ============================================================
//  Phase 5.8: Ink Material System — Visual Modifier Only
//
//  核心原则：
//  🎯 Ink = 视觉修饰层（NOT physics / NOT geometry）
//  🎯 完全 deterministic（同输入 = 同输出）
//  🎯 只作用于 opacity / edge / grain
//
//  三个核心材质函数：
//  1️⃣ Edge Softness  — 模拟"墨水边缘渗开感"
//  2️⃣ Grain          — 纸张纹理响应（PS 纸感）
//  3️⃣ Opacity Stability — 避免"闪烁感"
//
//  架构位置：
//    Input → PhysicsField → BrushKernel → GPUStamp
//                                              ↓
//                                      InkMaterialSystem (visual only)
//                                              ↓
//                                      GPU Renderer (final output)
//
//  约束：
//  ❌ 不引入时间依赖 simulation
//  ❌ 不改变 stroke geometry（不改 inkW / radius）
//  ❌ 不增加 CPU/GPU 双重计算
//  ✅ 纯视觉修饰 — cosmetic only
//  ✅ 完全 deterministic
// ============================================================

// ============================================================
//  Types
// ============================================================

/** InkMaterialSystem 输入 — 来自 GPUStamp + 上下文 */
export interface InkMaterialInput {
  /** stamp 基础不透明度 */
  opacity: number;
  /** 规范化压力 0~1（来自 BrushKernel） */
  pressure: number;
  /** Deterministic seed */
  seed: number;
}

/** InkMaterialSystem 输出 — 仅视觉修饰 */
export interface InkMaterialOutput {
  /** 最终不透明度（已应用 grain + stability） */
  finalOpacity: number;
  /** 边缘柔化因子 0~1（1 = 最硬，越小越软） */
  edgeSoftness: number;
  /** 颗粒强度 0~1（0 = 无颗粒，1 = 最强） */
  grainStrength: number;
}

// ============================================================
//  Constants
// ============================================================

/** Edge softness: pressure range for smoothstep */
const EDGE_SOFT_P0 = 0.4;
const EDGE_SOFT_P1 = 0.9;
const EDGE_SOFT_STRENGTH = 0.25;

/** Grain: hash constants */
const GRAIN_HASH_MUL = 12.9898;
const GRAIN_HASH_ADD = 43758.5453;
const GRAIN_BASE = 0.85;
const GRAIN_AMPLITUDE = 0.15;

/** Opacity stability */
const OPACITY_BASE = 0.9;
const OPACITY_PRESSURE_WEIGHT = 0.1;

// ============================================================
//  Pure Functions — 三个材质函数
// ============================================================

/**
 * 1️⃣ Edge Softness — 模拟"墨水边缘渗开感"
 *
 * edge = smoothstep(0.4, 0.9, pressure)
 * edgeSoftness = 1.0 - edge * 0.25
 *
 * 高压 → edge ≈ 1 → edgeSoftness ≈ 0.75（更软的边缘）
 * 低压 → edge ≈ 0 → edgeSoftness ≈ 1.0（更硬的边缘）
 *
 * @param pressure 规范化压力 0~1
 * @returns        边缘柔化因子 0.75~1.0
 */
export function edgeSoftness(pressure: number): number {
  const t = Math.max(0, Math.min(1, (pressure - EDGE_SOFT_P0) / (EDGE_SOFT_P1 - EDGE_SOFT_P0)));
  const edge = t * t * (3 - 2 * t); // smoothstep
  return 1.0 - edge * EDGE_SOFT_STRENGTH;
}

/**
 * 2️⃣ Grain — 纸张纹理响应（PS 纸感）
 *
 * grain = fract(sin(seed * 12.9898) * 43758.5453)
 * grainStrength = 0.85 + grain * 0.15
 *
 * 纯 deterministic hash — 同 seed → 同 grain
 *
 * @param seed Deterministic seed
 * @returns    颗粒强度 0.85~1.0
 */
export function grainStrength(seed: number): number {
  const grain = fract(Math.sin(seed * GRAIN_HASH_MUL) * GRAIN_HASH_ADD);
  return GRAIN_BASE + grain * GRAIN_AMPLITUDE;
}

/**
 * 3️⃣ Opacity Stability — 避免"闪烁感"
 *
 * finalOpacity = opacity * (0.9 + pressure * 0.1)
 *
 * 低压 → finalOpacity = opacity * 0.9
 * 高压 → finalOpacity = opacity * 1.0
 *
 * @param opacity   基础不透明度
 * @param pressure  规范化压力
 * @returns         稳定后的不透明度
 */
export function opacityStability(opacity: number, pressure: number): number {
  return opacity * (OPACITY_BASE + pressure * OPACITY_PRESSURE_WEIGHT);
}

// ============================================================
//  Helpers
// ============================================================

function fract(x: number): number {
  return x - Math.floor(x);
}

// ============================================================
//  InkMaterialSystem — 统一材质评估
// ============================================================

export class InkMaterialSystem {
  /**
   * 评估墨水材质 — 纯视觉修饰，不改变 shape。
   *
   * 纯函数 — 相同输入永远相同输出。
   *
   * @param input 材质输入（opacity, pressure, seed）
   * @returns     材质输出（finalOpacity, edgeSoftness, grainStrength）
   */
  static evaluate(input: InkMaterialInput): InkMaterialOutput {
    const edge = edgeSoftness(input.pressure);
    const grain = grainStrength(input.seed);
    const opacity = opacityStability(input.opacity, input.pressure);

    // Ink feel: pressure-driven opacity for bold ink stroke
    const finalOpacity = Math.min(1, 0.35 + 0.65 * input.pressure);

    return {
      finalOpacity,
      edgeSoftness: edge,
      grainStrength: grain,
    };
  }
}
