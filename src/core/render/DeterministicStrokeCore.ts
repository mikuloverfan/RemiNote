// ============================================================
//  Phase 3.2: Deterministic Stroke Core
//  Pure functions — no time, no frame, no hidden state.
//
//  原则：
//  ❌ 禁止 Math.random / Date.now / performance.now
//  ❌ 禁止 mutable state / previous frame dependency
//  ✅ 纯函数：相同输入 → 永远相同输出
// ============================================================

// ============================================================
//  Deterministic Hash (FNV-1a variant)
// ============================================================

/**
 * Deterministic 32-bit hash from string.
 * Same input → always same output. No randomness, no timestamp.
 */
export function deterministicHash(input: string): number {
  let h = 2166136261; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619); // FNV prime
    h = (h >>> 0); // ensure unsigned 32-bit
  }
  return h;
}

/**
 * Deterministic hash from multiple values.
 */
export function deterministicHashMulti(...values: (string | number)[]): number {
  return deterministicHash(values.map(v => String(v)).join('|'));
}

// ============================================================
//  Types
// ============================================================

export interface ResampledPoint {
  x: number;
  y: number;
  /** Per-point ink width (brush-computed, frozen at collection time) */
  _inkWidth?: number;
}

// ============================================================
//  resamplePointsDeterministic — PURE FUNCTION
//
//  输入: raw points + target spacing + seed
//  输出: uniformly spaced resampled points
//
//  约束:
//  ❌ 不依赖 previous frame state
//  ❌ 不依赖 velocity history
//  ❌ 不依赖 smoothing accumulate
//  ✅ for-loop pure computation
// ============================================================

/**
 * Deterministic arc-length resampling.
 *
 * @param points     Raw input points with _inkWidth
 * @param spacing    Target spacing in px (default 2)
 * @param _seed      Deterministic seed (reserved for future)
 * @returns          Uniformly spaced points
 */
export function resamplePointsDeterministic(
  points: readonly ResampledPoint[],
  spacing: number = 2,
  _seed?: number,
): ResampledPoint[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [{ ...points[0] }];

  const result: ResampledPoint[] = [{ ...points[0] }];
  let accumDist = 0;
  let last = { ...points[0] };

  for (let i = 1; i < points.length; i++) {
    const target = points[i];
    let dx = target.x - last.x;
    let dy = target.y - last.y;
    let dist = Math.hypot(dx, dy);

    while (dist >= spacing) {
      const t = spacing / dist;
      const newPt: ResampledPoint = {
        x: last.x + dx * t,
        y: last.y + dy * t,
        _inkWidth: last._inkWidth != null && target._inkWidth != null
          ? last._inkWidth + (target._inkWidth - last._inkWidth) * t
          : (target._inkWidth ?? last._inkWidth),
      };
      result.push(newPt);
      accumDist += spacing;
      last = { x: newPt.x, y: newPt.y, _inkWidth: newPt._inkWidth };
      dx = target.x - last.x;
      dy = target.y - last.y;
      dist = Math.hypot(dx, dy);
    }
  }

  return result;
}

// ============================================================
//  buildCanonicalSegments — PURE FUNCTION
//
//  输入: resampled points + brush size + seed
//  输出: immutable StrokeSegment[]
//
//  每个 segment:
//    { p0, p1, width0, width1, index, seed }
//
//  width = baseWidth * inkFactor(pointIndex, brush)
//
//  约束:
//  ❌ 禁止 runtime velocity re-evaluation
//  ❌ 禁止 taper / pressure / smoothing 计算
//  ✅ 纯数据转换: points → segments
// ============================================================

export interface CanonicalSegment {
  p0: { x: number; y: number };
  p1: { x: number; y: number };
  width0: number;
  width1: number;
  /** 0-based segment index */
  index: number;
  /** Deterministic seed for this segment */
  seed: number;
}

/**
 * Build canonical segments from resampled points.
 *
 * width = (point._inkWidth) || baseWidth
 * No velocity re-evaluation. No taper re-application.
 * Widths are frozen at point collection time.
 *
 * @param points      Resampled points (with _inkWidth)
 * @param baseWidth   Fallback width if _inkWidth missing
 * @param seed        Stroke-level seed
 * @returns           Immutable segment array
 */
export function buildCanonicalSegments(
  points: readonly ResampledPoint[],
  baseWidth: number,
  seed: number,
): CanonicalSegment[] {
  return buildSegmentsCore(points, baseWidth, seed);
}

// ============================================================
//  computeCanonicalHash — PURE FUNCTION
//
//  输入: segments[]
//  输出: deterministic hash string
//
//  用途: debug一致性验证 / replay / undo/redo correctness
// ============================================================

/**
 * Compute deterministic hash of all segments.
 * Same segments → always same hash.
 */
export function computeCanonicalHash(
  segments: readonly CanonicalSegment[],
  seed: number,
): string {
  let h = seed;
  for (const seg of segments) {
    h = deterministicHashMulti(
      h,
      Math.round(seg.p0.x * 100),
      Math.round(seg.p0.y * 100),
      Math.round(seg.p1.x * 100),
      Math.round(seg.p1.y * 100),
      Math.round(seg.width0 * 1000),
      Math.round(seg.width1 * 1000),
    );
  }
  return 'c_' + (h >>> 0).toString(16);
}

// ============================================================
//  compileStrokePure — PURE FUNCTION (Phase 3.3.1 Safety)
//
//  输入: raw stroke points + brush size + seed
//  输出: readonly CanonicalSegment[]
//
//  用于 renderFrame fallback: 当 _canonicalSegments 不存在时
//  （live stroke 绘制中），从 raw points 即时编译 segments。
//
//  约束:
//  ❌ 不修改 stroke 本体
//  ❌ 不写入 workspace map
//  ❌ 不持有引用缓存
//  ✅ 纯函数，永远相同输入→相同输出
// ============================================================

/**
 * Pure stroke compilation — builds segments from raw points.
 *
 * Intentionally simple: no resampling, no Catmull-Rom.
 * Direct line segments between consecutive points.
 * Width from _inkWidth, fallback to baseWidth.
 *
 * This is the LIVE STROKE render path.
 * Canonical resampled segments are built at endStroke.
 */
export function compileStrokePure(
  points: readonly ResampledPoint[],
  baseWidth: number,
  seed: number,
): CanonicalSegment[] {
  return buildSegmentsCore(points, baseWidth, seed);
}

// ============================================================
//  buildSegmentsCore — SINGLE GEOMETRY BUILDER (Phase 3.8)
//
//  唯一允许生成 { p0, p1, width0, width1, index, seed } 的函数。
//  buildCanonicalSegments 和 compileStrokePure 均委托至此。
// ============================================================

/**
 * Single geometry authority — builds CanonicalSegment[] from points.
 *
 * @param points     Input points (raw or resampled)
 * @param baseWidth  Fallback width
 * @param seed       Deterministic seed
 */
function buildSegmentsCore(
  points: readonly ResampledPoint[],
  baseWidth: number,
  seed: number,
): CanonicalSegment[] {
  if (!points || points.length < 2) return [];

  const segments: CanonicalSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const segSeed = deterministicHashMulti(seed, i);

    segments.push({
      p0: { x: p0.x, y: p0.y },
      p1: { x: p1.x, y: p1.y },
      width0: p0._inkWidth ?? baseWidth,
      width1: p1._inkWidth ?? baseWidth,
      index: i,
      seed: segSeed,
    });
  }
  return segments;
}
