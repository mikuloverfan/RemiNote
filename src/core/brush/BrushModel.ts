// ============================================================
//  Phase 1: Brush Model Abstraction Layer
//  Brush = pure configuration object — zero logic, zero side effects.
//
//  核心约束：
//  ❌ Brush 不包含任何渲染逻辑
//  ❌ Brush 不感知 input / render / geometry 层
//  ❌ Brush 不包含任何可变状态
//  ✅ Brush = 纯数据，可序列化，可 deep clone
//  ✅ 所有 F1-F4 输入行为由 Brush 字段驱动
//
//  架构：
//  Input Layer   → reads Brush.{smoothing, velocitySensitivity, pressureCurve, taperStart, taperEnd}
//  Geometry Layer → completely unaware of Brush (already true)
//  Render Layer  → reads Brush.{size, hardness}
// ============================================================

// ============================================================
//  Types
// ============================================================

/**
 * Width profile type — controls how stroke width changes from start to end.
 *
 * - 'brush'  : 毛笔感，起笔缓渐变粗，收笔自然渐细 (sin eased)
 * - 'pen'    : 钢笔感，快速达到全宽，收笔有细尾 (pow 0.5)
 * - 'pencil' : 铅笔感，几乎无 taper，稳定宽度
 * - 'marker' : 马克笔，起笔快、收笔有拖尾
 */
export type WidthProfile = 'brush' | 'pen' | 'pencil' | 'marker';

/**
 * Brush — 纯配置对象，定义一笔 stroke 的所有视觉与行为参数。
 *
 * 字段语义：
 * - id: 唯一标识符，用于 preset 切换
 * - size: 基础笔宽（世界坐标 px），映射到 strokeWidth
 * - hardness: 笔触边缘硬度 0~1。
 *     0 = 完全柔和（soft brush），1 = 完全锐利（hard pen）。
 *     映射到 shadowBlur 羽化半径。
 * - smoothing: 输入平滑强度 0~1。
 *     0 = 无平滑（原始输入），1 = 最大平滑。
 *     映射到：jitter threshold + lerp alpha + micro-jitter strength。
 * - velocitySensitivity: 速度对笔宽的影响强度 0~1。
 *     0 = 速度不影响笔宽（恒定宽度），1 = 最大速度调制。
 *     映射到：velocity→width factor + inkScalar velocity weight。
 * - pressureCurve: 压力响应曲线指数 0.5~3.0。
 *     1.0 = 线性，< 1 = 轻压即宽，> 1 = 重压才宽（PS 风格默认 1.6）。
 * - taperStart: 起笔淡入强度 0~1。
 *     0 = 无淡入（立即全宽），1 = 最大淡入（从 0 开始）。
 * - taperEnd: 收笔淡出强度 0~1。
 *     0 = 无淡出，1 = 最大淡出。
 * - widthProfile: ⭐ 宽度曲线类型，控制起收笔的形态。
 * - grainIntensity: ⭐ 纸纹颗粒强度 0~1。0=无颗粒，1=强颗粒纹理。
 * - flow: ⭐ 墨水流体感 0~1。0=即时响应，1=宽度带惯性滞后。
 */
export interface Brush {
  /** Unique preset identifier */
  readonly id: string;
  /** Base stroke width in world px (0.3 ~ 8.0) */
  readonly size: number;
  /** Edge hardness 0~1 (0=soft, 1=hard) */
  readonly hardness: number;
  /** Input smoothing 0~1 (0=raw, 1=max smooth) */
  readonly smoothing: number;
  /** Velocity→width modulation 0~1 (0=none, 1=max) */
  readonly velocitySensitivity: number;
  /** Pressure response curve exponent 0.5~3.0 */
  readonly pressureCurve: number;
  /** Stroke start taper intensity 0~1 */
  readonly taperStart: number;
  /** Stroke end taper intensity 0~1 */
  readonly taperEnd: number;
  /** ⭐ Width profile — controls taper curve shape */
  readonly widthProfile: WidthProfile;
  /** ⭐ Paper grain intensity 0~1 */
  readonly grainIntensity: number;
  /** ⭐ Ink flow/smear 0~1 — higher = more ink pooling */
  readonly flow: number;
}

// ============================================================
//  Internal Constants (derived from Brush, NOT hardcoded)
// ============================================================

/** Maximum taper duration in ms — scaled by Brush.taperStart */
export const MAX_TAPER_MS = 120;

/** End taper range — 1 - taperEnd * END_TAPER_RANGE gives min multiplier */
export const END_TAPER_RANGE = 0.7;

/** Jitter threshold range mapped from smoothing */
export const JITTER_RANGE = { min: 0.3, max: 2.5 } as const;

/** Lerp alpha range mapped from smoothing */
export const LERP_ALPHA_RANGE = { min: 0.08, max: 0.40 } as const;

/** Micro-jitter strength range mapped from smoothing (inverted) */
export const MICRO_JITTER_RANGE = { maxAngleFreq: 10.0, maxAmplitude: 0.25 } as const;

/** Velocity smoothing ratio — fixed internal, not exposed to Brush */
export const VELOCITY_SMOOTH_RATIO = { prev: 0.85, current: 0.15 } as const;

/** Ink scalar velocity influence weight (0~1, blended with pressure) */
export const INK_SCALAR_PRESSURE_WEIGHT = 0.65;

/** Ink scalar post-curve exponent */
export const INK_SCALAR_CURVE_EXP = 0.75;

/** Pressure canonicalization: default value when no pressure device */
export const PRESSURE_DEFAULT = 0.55;

/** Pressure canonicalization: warmup point count */
export const PRESSURE_WARMUP_COUNT = 3;

// ============================================================
//  Brush Factory
// ============================================================

/**
 * Create a Brush with all fields explicitly set.
 * Returns a frozen (immutable) Brush object.
 */
export function createBrush(partial: Partial<Brush> & { id: string }): Readonly<Brush> {
  return Object.freeze({
    id: partial.id,
    size: partial.size ?? 1.5,
    hardness: partial.hardness ?? 0.5,
    smoothing: partial.smoothing ?? 0.5,
    velocitySensitivity: partial.velocitySensitivity ?? 0.5,
    pressureCurve: partial.pressureCurve ?? 1.6,
    taperStart: partial.taperStart ?? 0.5,
    taperEnd: partial.taperEnd ?? 0.5,
    widthProfile: partial.widthProfile ?? 'pen',
    grainIntensity: partial.grainIntensity ?? 0,
    flow: partial.flow ?? 0,
  });
}

/**
 * Deep clone a Brush (returns mutable copy).
 * Useful when a tool needs to derive a modified brush.
 */
export function cloneBrush(brush: Readonly<Brush>): Brush {
  return {
    id: brush.id,
    size: brush.size,
    hardness: brush.hardness,
    smoothing: brush.smoothing,
    velocitySensitivity: brush.velocitySensitivity,
    pressureCurve: brush.pressureCurve,
    taperStart: brush.taperStart,
    taperEnd: brush.taperEnd,
    widthProfile: brush.widthProfile,
    grainIntensity: brush.grainIntensity,
    flow: brush.flow,
  };
}

// ============================================================
//  Brush → Internal Parameter Derivation (pure functions)
// ============================================================

/**
 * Derive the jitter threshold (px) from Brush.smoothing.
 * Higher smoothing → higher threshold → more aggressive jitter filtering.
 *
 *   smoothing=0   → jitterThreshold = JITTER_RANGE.min (0.3px, keep most input)
 *   smoothing=1   → jitterThreshold = JITTER_RANGE.max (2.5px, aggressive filter)
 */
export function deriveJitterThreshold(smoothing: number): number {
  const s = Math.max(0, Math.min(1, smoothing));
  return JITTER_RANGE.min + s * (JITTER_RANGE.max - JITTER_RANGE.min);
}

/**
 * Derive the lerp alpha for input smoothing from Brush.smoothing.
 * Higher smoothing → lower alpha → stronger smoothing effect.
 *
 *   smoothing=0   → alpha = LERP_ALPHA_RANGE.max (0.40, fast response)
 *   smoothing=1   → alpha = LERP_ALPHA_RANGE.min (0.08, heavy smoothing)
 */
export function deriveLerpAlpha(smoothing: number): number {
  const s = Math.max(0, Math.min(1, smoothing));
  return LERP_ALPHA_RANGE.max - s * (LERP_ALPHA_RANGE.max - LERP_ALPHA_RANGE.min);
}

/**
 * Derive micro-jitter strength from Brush.smoothing (inverted).
 * Higher smoothing → less micro-jitter.
 *
 *   smoothing=0   → max micro-jitter (angleFreq=10, amplitude=0.25)
 *   smoothing=1   → no micro-jitter (amplitude=0)
 */
export function deriveMicroJitter(smoothing: number): { angleFreq: number; amplitude: number } {
  const s = Math.max(0, Math.min(1, smoothing));
  const invS = 1 - s;
  return {
    angleFreq: 2.0 + invS * (MICRO_JITTER_RANGE.maxAngleFreq - 2.0),
    amplitude: invS * MICRO_JITTER_RANGE.maxAmplitude,
  };
}

/**
 * Derive velocity→width modulation factor from Brush.velocitySensitivity.
 *
 *   velocitySensitivity=0   → no velocity effect (factor=0)
 *   velocitySensitivity=1   → max velocity effect (factor=0.005)
 *
 * Applied as: speedFactor = 1 - smoothedVelocity * factor
 * Then shaped through pressureCurve.
 */
export function deriveVelocityFactor(velocitySensitivity: number): number {
  const s = Math.max(0, Math.min(1, velocitySensitivity));
  return s * 0.005;
}

/**
 * Derive ink scalar velocity weight from Brush.velocitySensitivity.
 *
 *   velocitySensitivity=0   → pressure-only (inkScalar = pressure)
 *   velocitySensitivity=1   → max velocity influence (inkScalar = 0.65p + 0.35v)
 */
export function deriveInkVelocityWeight(velocitySensitivity: number): number {
  const s = Math.max(0, Math.min(1, velocitySensitivity));
  return s * (1 - INK_SCALAR_PRESSURE_WEIGHT); // max 0.35 when s=1
}

/**
 * Derive start taper duration (ms) from Brush.taperStart.
 *
 *   taperStart=0   → 0ms (no fade-in)
 *   taperStart=1   → MAX_TAPER_MS (full fade-in)
 */
export function deriveTaperStartMs(taperStart: number): number {
  return Math.max(0, Math.min(1, taperStart)) * MAX_TAPER_MS;
}

/**
 * Derive end taper minimum multiplier from Brush.taperEnd.
 *
 *   taperEnd=0   → 1.0 (no fade-out)
 *   taperEnd=1   → 1 - END_TAPER_RANGE (max fade-out, ≈ 0.3)
 */
export function deriveTaperEndMin(taperEnd: number): number {
  const s = Math.max(0, Math.min(1, taperEnd));
  return 1.0 - s * END_TAPER_RANGE;
}

/**
 * Derive the end taper velocity threshold from Brush.taperEnd.
 * Below this velocity, the end taper starts applying.
 *
 *   taperEnd=0   → threshold=0 (never triggers)
 *   taperEnd=1   → threshold=0.08
 */
export function deriveTaperEndThreshold(taperEnd: number): number {
  const s = Math.max(0, Math.min(1, taperEnd));
  return s * 0.08;
}

// ============================================================
//  Default Brush
// ============================================================

/**
 * Default brush — encodes the current F1-F4 behavior as a Brush config.
 * This is the "PS Pen" feel that was previously hardcoded.
 */
export const DEFAULT_BRUSH: Readonly<Brush> = createBrush({
  id: 'default',
  size: 8,
  hardness: 0.5,
  smoothing: 0.5,
  velocitySensitivity: 0.5,
  pressureCurve: 1.6,
  taperStart: 0.5,
  taperEnd: 0.5,
});
