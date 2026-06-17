// ============================================================
//  Phase 3.1: Feel Calibration Layer — Stability Lock
//
//  约束（强）：
//  ❌ 不修改 geometry pipeline (points/segments/resampleStroke)
//  ❌ 不修改 BrushModel 结构
//  ❌ 不修改 renderFrame
//  ✅ 仅调制 addPoint 输入层 + inkWidth
//
//  Feel Layer 必须满足：
//  ✔ 不改变轨迹形状（geometry invariant）
//  ✔ 不改变 segment topology
//  ✔ 只改变视觉权重（inkWidth）
// ============================================================

// ============================================================
//  Types
// ============================================================

export interface FeelConfig {
  /** Micro-jitter amplitude multiplier 0~2 (default 1.0).
   *  0 = no jitter, 2 = max jitter. Clamped to ≤0.2px per axis. */
  readonly microJitter: number;
  /** Velocity lerp factor k ∈ [0.05, 0.3] (default 0.175).
   *  Controls how fast smoothedVelocity tracks raw velocity.
   *  Only affects inkWidth, never geometry. */
  readonly velocityDamping: number;
  /** Pressure response curve multiplier 0.5~2 (default 1.0).
   *  Output always clamped to [0.15, 1.0]. */
  readonly pressureResponse: number;
  /** Taper curve shaping 0~2 (default 1.0).
   *  ENDPOINT-ONLY: only affects points[0] (start) and points[last] (end).
   *  Never touches middle points or segments. */
  readonly taperCurve: number;
  /** Stroke start adhesion strength 0~2 (default 1.0).
   *  INKWIDTH-ONLY: multiplies _inkWidth on first 5 points.
   *  Never affects point position or resample. */
  readonly strokeAdhesion: number;
}

// ============================================================
//  Default Feel
// ============================================================

export const DEFAULT_FEEL: Readonly<FeelConfig> = Object.freeze({
  microJitter: 1.0,
  velocityDamping: 1.0,
  pressureResponse: 1.0,
  taperCurve: 1.0,
  strokeAdhesion: 1.0,
});

// ============================================================
//  Stability constants
// ============================================================

/** Max jitter displacement per axis (px). Non-negotiable. */
const MAX_JITTER_PX = 0.2;

/** Min pressure output. Prevents zero-width strokes. */
const MIN_PRESSURE_OUTPUT = 0.15;

/** Max pressure output. Prevents width amplification. */
const MAX_PRESSURE_OUTPUT = 1.0;

/** Velocity lerp k bounds. */
const VEL_K_MIN = 0.05;
const VEL_K_MAX = 0.30;
const VEL_K_DEFAULT = 0.175;

// ============================================================
//  1️⃣ microJitter — 非累积确定性噪声（geometry invariant）
//
//  规则：
//  - sin(hash(pointIndex)) → zero expectation, no drift
//  - clamp ≤ 0.2px per axis
//  - 禁止基于 velocity / 方向 / 时间累积
//  - 作用于 smoothed point 之后
// ============================================================

/** Simple deterministic hash — always same output for same input. */
function hashPointIndex(index: number): number {
  // Knuth multiplicative hash
  const h = ((index * 2654435761) >>> 0);
  return (h % 10000) / 10000; // 0~1
}

/**
 * Compute non-accumulating micro-jitter displacement for a point.
 *
 *   jitterX = sin(hash * PI * 2) * amplitude   (expectation = 0)
 *   jitterY = cos(hash * PI * 2) * amplitude   (expectation = 0)
 *
 * @param pointIndex  0-based point index in current stroke
 * @param baseAmplitude  Brush-derived micro-jitter amplitude
 * @param feel  FeelConfig
 * @returns { dx, dy } — per-axis jitter displacement, each ≤ 0.2px
 */
export function computeMicroJitter(
  pointIndex: number,
  baseAmplitude: number,
  feel: FeelConfig,
): { dx: number; dy: number } {
  const amp = baseAmplitude * Math.max(0, Math.min(2, feel.microJitter));
  if (amp < 0.001) return { dx: 0, dy: 0 };

  const h = hashPointIndex(pointIndex);
  const phase = h * Math.PI * 2;

  const rawDx = Math.sin(phase) * amp;
  const rawDy = Math.cos(phase) * amp;

  return {
    dx: Math.max(-MAX_JITTER_PX, Math.min(MAX_JITTER_PX, rawDx)),
    dy: Math.max(-MAX_JITTER_PX, Math.min(MAX_JITTER_PX, rawDy)),
  };
}

// ============================================================
//  2️⃣ velocityDamping — 单调稳定（inkWidth only）
//
//  规则：
//  - k ∈ [0.05, 0.3]
//  - 禁止 feel 直接修改 velocity scale
//  - 只影响 inkWidth，不参与 geometry
// ============================================================

/**
 * Compute velocity lerp factor k from FeelConfig.
 *
 *   feel=0.0 → k=VEL_K_MIN (0.05, heaviest smoothing)
 *   feel=1.0 → k=VEL_K_DEFAULT (0.175, neutral)
 *   feel=2.0 → k=VEL_K_MAX (0.30, most responsive)
 *
 * k controls how fast smoothedVelocity tracks raw velocity:
 *   smoothedVelocity = smoothedVelocity * (1-k) + rawVelocity * k
 *
 * ⚠️  This ONLY affects inkWidth computation.
 *    Velocity must NEVER change segment shape.
 */
export function computeVelocityLerpK(feel: FeelConfig): number {
  const t = Math.max(0, Math.min(2, feel.velocityDamping)) / 2; // 0~1
  const k = VEL_K_MIN + t * (VEL_K_MAX - VEL_K_MIN);
  return k;
}

// ============================================================
//  3️⃣ pressureCurve — 输出限幅 [0.15, 1.0]
//
//  规则：
//  - output = clamp(pow(raw, curve), 0.15, 1.0)
//  - 禁止 pressure > 1.0 放大
//  - 禁止 pressure 影响坐标
//  - pressure 只影响 inkWidth
// ============================================================

/**
 * Compute effective pressure curve exponent and clamp output.
 *
 *   effectiveCurve = brush.pressureCurve * feel.pressureResponse
 *   output = clamp(pow(linearFactor, effectiveCurve), 0.15, 1.0)
 *
 * @param linearFactor  Raw linear factor (already in [0, 1])
 * @param brushCurve    Brush.pressureCurve
 * @param feel          FeelConfig
 * @returns             Clamped speedFactor in [0.15, 1.0]
 */
export function computePressureOutput(
  linearFactor: number,
  brushCurve: number,
  feel: FeelConfig,
): number {
  const response = Math.max(0.5, Math.min(2, feel.pressureResponse));
  const effectiveCurve = brushCurve * response;
  const raw = Math.pow(Math.max(0, Math.min(1, linearFactor)), effectiveCurve);
  return Math.max(MIN_PRESSURE_OUTPUT, Math.min(MAX_PRESSURE_OUTPUT, raw));
}

// ============================================================
//  4️⃣ taper — 端点函数（仅 points[0] / points[last]）
//
//  规则：
//  - startTaper 仅作用于 points[0]
//  - endTaper 仅作用于 points[last]
//  - 禁止 taper 影响中间点
//  - 禁止 taper 影响 segments
//  - endTaper 在 endStroke 时应用
// ============================================================

/**
 * Compute start taper multiplier for the first point only.
 *
 *   rawTaper = clamp(age / taperStartMs, 0, 1)
 *   output = pow(rawTaper, 1 + feel.taperCurve)
 *
 * ⚠️  Caller must only apply this when pointIndex === 0.
 */
export function computeStartTaper(
  ageMs: number,
  taperStartMs: number,
  feel: FeelConfig,
): number {
  if (taperStartMs <= 0) return 1.0;
  const raw = Math.max(0, Math.min(1, ageMs / taperStartMs));
  const curve = 1.0 + Math.max(0, Math.min(2, feel.taperCurve));
  return Math.pow(raw, curve);
}

/**
 * Compute end taper multiplier for the last point only.
 *
 *   rawTaper = velocity < threshold ? taperEndMin : 1.0
 *   output = pow(rawTaper, 1 + feel.taperCurve)
 *
 * ⚠️  Caller must only apply this to the LAST point, at endStroke time.
 */
export function computeEndTaper(
  smoothedVelocity: number,
  taperEndThreshold: number,
  taperEndMin: number,
  feel: FeelConfig,
): number {
  const raw = smoothedVelocity < taperEndThreshold ? taperEndMin : 1.0;
  const curve = 1.0 + Math.max(0, Math.min(2, feel.taperCurve));
  return Math.pow(Math.max(0, Math.min(1, raw)), curve);
}

// ============================================================
//  5️⃣ strokeAdhesion — inkWidth 乘法（禁止坐标影响）
//
//  规则：
//  - 仅影响 inkWidth multiplier
//  - ❌ 不允许影响 point position
//  - ❌ 不允许影响 resample
//  - decay over first 5 points
// ============================================================

/**
 * Compute stroke adhesion inkWidth multiplier.
 *
 *   pointIndex 0~4: multiplier = 1 - strength * 0.15 * (1 - index/5)
 *   pointIndex 5+:   multiplier = 1.0
 *
 * @param pointIndex  0-based point index in stroke
 * @param feel        FeelConfig
 * @returns           Multiplier in [0.85, 1.0]
 */
export function computeStrokeAdhesion(
  pointIndex: number,
  feel: FeelConfig,
): number {
  const strength = Math.max(0, Math.min(2, feel.strokeAdhesion));
  if (strength === 0 || pointIndex > 4) return 1.0;

  const decay = 1.0 - (pointIndex / 5);
  const adhesionAmount = strength * 0.15 * decay;
  return 1.0 - adhesionAmount;
}

// ============================================================
//  Factory
// ============================================================

export function createFeelConfig(partial: Partial<FeelConfig> = {}): Readonly<FeelConfig> {
  return Object.freeze({
    microJitter: partial.microJitter ?? 1.0,
    velocityDamping: partial.velocityDamping ?? 1.0,
    pressureResponse: partial.pressureResponse ?? 1.0,
    taperCurve: partial.taperCurve ?? 1.0,
    strokeAdhesion: partial.strokeAdhesion ?? 1.0,
  });
}
