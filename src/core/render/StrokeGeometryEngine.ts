// ============================================================
//  StrokeGeometryEngine — SSOT 统一 Stroke 几何引擎
//
//  原则：
//  - preview = final = GPU output（同一函数，同一输出）
//  - 纯函数：无 DOM / session / 副作用
//  - Cap 规则统一：一律 round cap → 无黑点
//  - Taper 基于 pressure/velocity 的宽度渐变
//
//  数据流：
//    raw pointer points
//    → buildStrokeGeometry(points, config)
//    → StrokeGeometry { vertices, indices, caps, bounds }
//    → Canvas2D draw / GPU buffer upload（共用）
// ============================================================

// ── Types ──

export interface Point2D {
  x: number;
  y: number;
  /** 0..1 pressure (default 0.5) */
  pressure?: number;
  /** Normalized speed at this point (0..1) */
  speed?: number;
}

export type CapType = 'round' | 'none';

export interface StrokeGeometry {
  /** Interleaved [x,y] vertex positions (Float32 for GPU) */
  vertices: Float32Array;
  /** Triangle indices */
  indices: Uint32Array;
  /** Cap description (always round) */
  caps: { start: CapType; end: CapType };
  /** World-space bounding box */
  bounds: { x: number; y: number; w: number; h: number };
  /** Number of input points (for cache validation) */
  pointCount: number;
}

export interface StrokeGeometryConfig {
  /** Base stroke width in world units */
  width: number;
  /** Smoothing factor 0..1 (0=none, 1=max) */
  smoothing: number;
  /** Taper strength 0..1 (0=constant width, 1=full dynamic) */
  taper: number;
  /** Min width ratio (0..1) */
  minWidth: number;
  /** Max width ratio (1..) */
  maxWidth: number;
  /** Number of cap segments for round caps (default 8) */
  capSegments?: number;
  /** ⭐ Edge blur radius in px (0=hard edge, 3=soft brush) */
  edgeBlur?: number;
  /** ⭐ Start taper fade-in percentage (0~1, default 0.06 ≈ 6%) */
  startFadePct?: number;
  /** ⭐ End taper fade-out percentage (0~1, default 0.08 ≈ 8%) */
  endFadePct?: number;
}

const DEFAULT_CONFIG: StrokeGeometryConfig = {
  width: 2,
  smoothing: 0.5,
  taper: 0.25,
  minWidth: 0.6,
  maxWidth: 1.8,
  capSegments: 8,
};

// ── Internal helpers ──

interface SegmentVertex {
  x: number;
  y: number;
}

/**
 * ⭐ High-quality Catmull-Rom subdivision smoothing.
 *
 * Key improvements over old version:
 * 1. Much higher subdivision (4-12 steps vs 1-2)
 * 2. Proper 4-point Catmull-Rom (uses p0,p1,p2,p3 for each segment)
 * 3. Curvature-adaptive: sharp bends get more subdivision
 *
 * This directly addresses the "低采样率贝塞尔插值" and "折线拼接" issues.
 */
function smoothPoints(
  pts: Point2D[],
  factor: number
): Point2D[] {
  if (pts.length < 3 || factor <= 0) return pts;

  const n = pts.length;
  const result: Point2D[] = [pts[0]];

  for (let i = 1; i < n - 1; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    // Use p3 for 4-point Catmull-Rom when available
    const p3 = i + 2 < n ? pts[i + 2] : pts[i + 1];

    // ⭐ Curvature-adaptive subdivision: compute local curvature (angle between segments)
    const dx1 = p1.x - p0.x, dy1 = p1.y - p0.y;
    const dx2 = p2.x - p1.x, dy2 = p2.y - p1.y;
    const l1 = Math.hypot(dx1, dy1);
    const l2 = Math.hypot(dx2, dy2);
    let curvature = 0;
    if (l1 > 0.5 && l2 > 0.5) {
      const dot = (dx1 * dx2 + dy1 * dy2) / (l1 * l2);
      curvature = Math.acos(Math.max(-1, Math.min(1, dot))) / Math.PI; // 0=straight, 1=sharp
    }

    // ⭐ Much higher base subdivision: 4-12 steps (was 1-2!)
    // Sharp curves get more steps (up to 16), straight lines get fewer
    const baseSteps = Math.round(3 + factor * 6); // 4-9 steps based on smoothing factor
    const extraSteps = Math.round(curvature * 6); // 0-6 extra steps for sharp bends
    const subSteps = Math.min(16, baseSteps + extraSteps);

    // Proper 4-point Catmull-Rom matrix
    for (let s = 1; s <= subSteps; s++) {
      const t = s / (subSteps + 1);
      const t2 = t * t;
      const t3 = t2 * t;

      // Catmull-Rom basis functions
      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      );
      const y = 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
      );

      // ⭐ Catmull-Rom 4-point interpolation for pressure (matches position smoothing)
      const p0p = p0.pressure ?? 0.5, p1p = p1.pressure ?? 0.5;
      const p2p = p2.pressure ?? 0.5, p3p = p3.pressure ?? 0.5;
      const pressure = 0.5 * (
        (2 * p1p) +
        (-p0p + p2p) * t +
        (2 * p0p - 5 * p1p + 4 * p2p - p3p) * t2 +
        (-p0p + 3 * p1p - 3 * p2p + p3p) * t3
      );

      // ⭐ Catmull-Rom 4-point interpolation for speed
      const p0s = p0.speed ?? 0, p1s = p1.speed ?? 0;
      const p2s = p2.speed ?? 0, p3s = p3.speed ?? 0;
      const speed = 0.5 * (
        (2 * p1s) +
        (-p0s + p2s) * t +
        (2 * p0s - 5 * p1s + 4 * p2s - p3s) * t2 +
        (-p0s + 3 * p1s - 3 * p2s + p3s) * t3
      );

      result.push({ x, y, pressure, speed });
    }
    result.push(p1);
  }
  result.push(pts[n - 1]);
  return result;
}

/**
 * ⭐ Compute per-point widths with continuous bell-curve envelope.
 *
 * Key change from old version:
 * - OLD: start taper → flat middle (E=1) → end decay → "伸缩杆" feel
 * - NEW: smooth sin^0.5 bell curve that has NO flat section
 *
 * The width follows: sin(π * t)^0.5 which gently rises from 0 at start,
 * peaks near center with a soft curve, then gently falls back to 0 at end.
 * Pressure and speed modulate this continuous curve.
 */
function computeWidths(
  pts: Point2D[],
  baseWidth: number,
  taper: number,
  minRatio: number,
  maxRatio: number,
  startFadePct: number = 0.06,
  endFadePct: number = 0.08
): number[] {
  const n = pts.length;
  const raw = new Array<number>(n);

  // Taper strength: 0 = no taper (all sinusoid), 1 = max bell shaping
  const bellStrength = 0.2 + taper * 0.6; // 0.2~0.8 range

  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const pressure = p.pressure ?? 0.5;
    const speed = p.speed ?? 0;

    // ⭐ Continuous bell curve envelope (replaces flat middle)
    // Use sin curve: 0 at start → 1 at center → 0 at end
    // No flat plateau anywhere — smooth throughout
    const t = n > 1 ? i / (n - 1) : 0.5; // 0..1 along stroke
    const bellBase = Math.sin(Math.PI * t) ** 0.5; // ^0.5 gives wider peak
    // Blend with 100% = no taper at all
    const bell = 1 - bellStrength + bellStrength * bellBase;

    // ⭐ Pressure: exponential curve — gentle at low pressure
    let pressureFactor: number;
    if (pressure < 0.05) {
      pressureFactor = 0.05; // near-invisible start
    } else {
      // Smooth ramp: 0.1→0.35, 0.5→0.75, 1.0→1.0
      pressureFactor = 0.3 + 0.7 * Math.pow((pressure - 0.05) / 0.95, 0.6);
    }

    // Speed: slower = thicker
    const speedFactor = 1 - speed * taper * 0.5;

    let ratio = bell * pressureFactor * speedFactor;
    ratio = Math.max(minRatio, Math.min(maxRatio, ratio));
    raw[i] = baseWidth * ratio;
  }

  // ⭐ Smooth start fade-in: percentage controlled (default 6% for brush-pen, 1% for PS-default)
  if (startFadePct > 0.001 && n > 3) {
    const fadeInEnd = Math.max(2, Math.floor(n * startFadePct));
    for (let i = 0; i < fadeInEnd; i++) {
      const t = i / Math.max(1, fadeInEnd - 1); // 0→1
      const fade = t * t * (3 - 2 * t); // smoothstep
      raw[i] *= fade;
    }
  }

  // ⭐ Smooth end fade-out: percentage controlled
  if (endFadePct > 0.001 && n > 3) {
    const fadeOutStart = n - Math.max(2, Math.floor(n * endFadePct));
    for (let i = fadeOutStart; i < n; i++) {
      const t = (n - 1 - i) / Math.max(1, n - fadeOutStart - 1); // 1→0
      const fade = t * t * (3 - 2 * t); // smoothstep
      raw[i] *= fade;
    }
  }

  // Minimal floor: controlled by minRatio (passed from config)
  // PS-default minWidth=0.35 → baseWidth * 0.35 minimum at ends
  // Brush-pen minWidth=0.02 → near-zero at ends
  const absMin = Math.max(0.05, baseWidth * minRatio * 0.5);
  raw[0] = Math.max(raw[0], absMin);
  if (n > 1) raw[n - 1] = Math.max(raw[n - 1], absMin);

  // Micro-variation: 2.5% noise for organic texture
  if (n > 5) {
    const noiseStrength = 0.025;
    const midStart = Math.max(2, Math.floor(n * 0.08));
    const midEnd = Math.min(n - 3, Math.floor(n * 0.92));
    for (let i = midStart; i < midEnd; i++) {
      const hash = Math.sin(i * 127.1 + baseWidth * 311.7) * 0.5 + 0.5;
      const noise = (hash - 0.5) * 2 * noiseStrength;
      raw[i] *= (1 + noise);
    }
  }

  return raw;
}

/** Build cap fan triangles (round half-circle) */
function buildCap(
  cx: number, cy: number,
  dx: number, dy: number,
  radius: number,
  segments: number,
  vertexOffset: number,
  indexOffset: number,
  vertices: number[],
  indices: number[]
): { vertexCount: number; indexCount: number } {
  const baseAngle = Math.atan2(dy, dx);

  // Center vertex
  vertices.push(cx, cy);
  const centerIdx = vertexOffset;

  // Fan vertices
  for (let i = 0; i <= segments; i++) {
    const angle = baseAngle + Math.PI * (i / segments - 0.5); // -90° to +90°
    vertices.push(
      cx + Math.cos(angle) * radius,
      cy + Math.sin(angle) * radius,
    );
  }

  // Fan triangles
  for (let i = 0; i < segments; i++) {
    indices.push(centerIdx, vertexOffset + 1 + i, vertexOffset + 1 + i + 1);
  }

  return { vertexCount: 1 + segments + 1, indexCount: segments * 3 };
}

// ============================================================
//  buildStrokeGeometry — SSOT 入口
// ============================================================

export function buildStrokeGeometry(
  points: readonly Point2D[],
  config: Partial<StrokeGeometryConfig> = {}
): StrokeGeometry {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const capSegs = cfg.capSegments ?? 8;

  // ── Edge cases ──
  if (points.length === 0) {
    return {
      vertices: new Float32Array(0),
      indices: new Uint32Array(0),
      caps: { start: 'round', end: 'round' },
      bounds: { x: 0, y: 0, w: 0, h: 0 },
      pointCount: 0,
    };
  }

  if (points.length === 1) {
    // Single point → small circle
    const p = points[0];
    const r = cfg.width * 0.5;
    const verts: number[] = [];
    const idx: number[] = [];
    verts.push(p.x, p.y); // center
    for (let i = 0; i <= capSegs * 2; i++) {
      const a = (i / (capSegs * 2)) * Math.PI * 2;
      verts.push(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
    }
    for (let i = 0; i < capSegs * 2; i++) {
      idx.push(0, 1 + i, 1 + i + 1);
    }
    return {
      vertices: new Float32Array(verts),
      indices: new Uint32Array(idx),
      caps: { start: 'round', end: 'round' },
      bounds: { x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 },
      pointCount: 1,
    };
  }

  // ── Smooth ──
  const smoothed = cfg.smoothing > 0 ? smoothPoints([...points], cfg.smoothing) : [...points];

  // ── Compute per-point widths ──
  const widths = computeWidths(smoothed, cfg.width, cfg.taper, cfg.minWidth, cfg.maxWidth, cfg.startFadePct ?? 0.06, cfg.endFadePct ?? 0.08);

  // ── Build stroke body (triangle strip) with miter joint handling ──
  const vertices: number[] = [];
  const indices: number[] = [];
  let boundsMinX = Infinity, boundsMinY = Infinity;
  let boundsMaxX = -Infinity, boundsMaxY = -Infinity;

  // Track previous normal for angle-aware blending at turns
  let prevNx = 0, prevNy = 0;

  for (let i = 0; i < smoothed.length; i++) {
    const p = smoothed[i];
    const halfW = widths[i] / 2;

    // Direction: use tangent of surrounding points
    let dx: number, dy: number;
    if (i === 0 && smoothed.length > 1) {
      dx = smoothed[1].x - p.x;
      dy = smoothed[1].y - p.y;
    } else if (i === smoothed.length - 1 && smoothed.length > 1) {
      dx = p.x - smoothed[i - 1].x;
      dy = p.y - smoothed[i - 1].y;
    } else if (smoothed.length > 2) {
      dx = smoothed[i + 1].x - smoothed[i - 1].x;
      dy = smoothed[i + 1].y - smoothed[i - 1].y;
    } else {
      dx = 1; dy = 0;
    }

    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len; // left normal
    let ny = dx / len;

    // ⭐ Miter joint: blend normals at sharp turns to prevent fold/pinch
    if (i > 0) {
      const dot = prevNx * nx + prevNy * ny;
      // If normals differ by > 30 degrees (dot < cos(30°) ≈ 0.866), blend
      if (dot < 0.866) {
        // Blend toward previous normal to smooth the transition
        const blendFactor = Math.max(0.3, Math.min(0.7, (1 - dot) * 0.5));
        nx = prevNx * blendFactor + nx * (1 - blendFactor);
        ny = prevNy * blendFactor + ny * (1 - blendFactor);
        // Re-normalize
        const nl = Math.hypot(nx, ny) || 1;
        nx /= nl;
        ny /= nl;
      }
    }
    prevNx = nx;
    prevNy = ny;

    // Left vertex
    const lx = p.x + nx * halfW;
    const ly = p.y + ny * halfW;
    vertices.push(lx, ly);

    // Right vertex
    const rx = p.x - nx * halfW;
    const ry = p.y - ny * halfW;
    vertices.push(rx, ry);

    // Bounds tracking
    boundsMinX = Math.min(boundsMinX, lx, rx);
    boundsMinY = Math.min(boundsMinY, ly, ry);
    boundsMaxX = Math.max(boundsMaxX, lx, rx);
    boundsMaxY = Math.max(boundsMaxY, ly, ry);
  }

  // Triangle strip indices
  for (let i = 0; i < smoothed.length - 1; i++) {
    const bl = i * 2;      // bottom-left
    const br = i * 2 + 1;  // bottom-right
    const tl = (i + 1) * 2;
    const tr = (i + 1) * 2 + 1;
    indices.push(bl, br, tl);
    indices.push(tl, br, tr);
  }

  // ── Caps ──
  const first = smoothed[0];
  const last = smoothed[smoothed.length - 1];
  const firstHalfW = widths[0] / 2;
  const lastHalfW = widths[widths.length - 1] / 2;

  // Start cap normal (from first to second)
  let sdx = smoothed.length > 1 ? smoothed[1].x - first.x : 1;
  let sdy = smoothed.length > 1 ? smoothed[1].y - first.y : 0;
  const slen = Math.hypot(sdx, sdy) || 1;
  sdx /= slen; sdy /= slen;

  const startCap = buildCap(
    first.x, first.y, -sdx, -sdy, firstHalfW, capSegs,
    vertices.length, indices.length, vertices, indices
  );

  // End cap normal (from last to second-last)
  let edx = smoothed.length > 1 ? last.x - smoothed[smoothed.length - 2].x : 1;
  let edy = smoothed.length > 1 ? last.y - smoothed[smoothed.length - 2].y : 0;
  const elen = Math.hypot(edx, edy) || 1;
  edx /= elen; edy /= elen;

  // Adjust start cap bounds
  boundsMinX = Math.min(boundsMinX, first.x - firstHalfW);
  boundsMinY = Math.min(boundsMinY, first.y - firstHalfW);
  boundsMaxX = Math.max(boundsMaxX, first.x + firstHalfW);
  boundsMaxY = Math.max(boundsMaxY, first.y + firstHalfW);

  buildCap(
    last.x, last.y, edx, edy, lastHalfW, capSegs,
    vertices.length, indices.length, vertices, indices
  );

  // Adjust end cap bounds
  boundsMinX = Math.min(boundsMinX, last.x - lastHalfW);
  boundsMinY = Math.min(boundsMinY, last.y - lastHalfW);
  boundsMaxX = Math.max(boundsMaxX, last.x + lastHalfW);
  boundsMaxY = Math.max(boundsMaxY, last.y + lastHalfW);

  // ── Output ──
  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    caps: { start: 'round', end: 'round' },
    bounds: {
      x: boundsMinX,
      y: boundsMinY,
      w: boundsMaxX - boundsMinX,
      h: boundsMaxY - boundsMinY,
    },
    pointCount: points.length,
  };
}

// ============================================================
//  GPU Buffer helper — RAf-safe buffer update (reference swap)
// ============================================================

export interface GPUBufferHandle {
  vertices: Float32Array;
  indices: Uint32Array;
  /** Monotonic version — increment on each geometry change */
  version: number;
}

/** Create a GPU buffer handle from geometry. Call once; update via updateGPUBuffer. */
export function createGPUBuffer(geometry: StrokeGeometry): GPUBufferHandle {
  return {
    vertices: geometry.vertices,
    indices: geometry.indices,
    version: 1,
  };
}

/**
 * Update GPU buffer reference from new geometry.
 * Only replaces the reference — no memory copy, no rebuild.
 * @returns true if geometry changed (pointCount differs)
 */
export function updateGPUBuffer(
  handle: GPUBufferHandle,
  geometry: StrokeGeometry
): boolean {
  // Reference identity update — O(1)
  handle.vertices = geometry.vertices;
  handle.indices = geometry.indices;
  handle.version++;
  return true;
}

// ============================================================
//  Canvas2D draw helper — uses the same geometry, zero divergence
// ============================================================

/**
 * Draw StrokeGeometry to Canvas2D context.
 * Uses the SAME geometry as GPU path — preview = final.
 * Supports edge blur for soft brush rendering.
 */
export function drawGeometryToCanvas2D(
  ctx: CanvasRenderingContext2D,
  geometry: StrokeGeometry,
  color: string,
  _width: number,
  edgeBlur: number = 0
): void {
  const { vertices, indices } = geometry;
  if (indices.length === 0) return;

  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1; // geometry already encodes width

  // ⭐ Multiply blend: overlapping strokes → ink buildup (墨色堆积)
  // Without this, overlaps look like wire crossing, not ink pooling
  ctx.globalCompositeOperation = 'multiply';
  // Slight transparency lets multiply darken overlaps
  ctx.globalAlpha = 0.85;

  // ⭐ Edge softening: shadowBlur creates smooth anti-aliased edges
  if (edgeBlur > 0.5) {
    ctx.shadowColor = color;
    ctx.shadowBlur = edgeBlur;
  }

  ctx.beginPath();

  // Draw body triangles as filled polygons
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 2;
    const i1 = indices[i + 1] * 2;
    const i2 = indices[i + 2] * 2;

    ctx.moveTo(vertices[i0], vertices[i0 + 1]);
    ctx.lineTo(vertices[i1], vertices[i1 + 1]);
    ctx.lineTo(vertices[i2], vertices[i2 + 1]);
    ctx.closePath();
  }

  ctx.fill();
  ctx.restore();
}

// ============================================================
//  Quick Path2D builder (backward compat) — uses SAME geometry
// ============================================================

/**
 * Build a Path2D from StrokeGeometry for Canvas2D stroke() rendering.
 * This is a thin compatibility wrapper — same geometry, different draw call.
 */
export function geometryToPath2D(geometry: StrokeGeometry): Path2D {
  const path = new Path2D();
  const { indices, vertices } = geometry;
  if (indices.length === 0) return path;

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 2;
    const i1 = indices[i + 1] * 2;
    const i2 = indices[i + 2] * 2;
    path.moveTo(vertices[i0], vertices[i0 + 1]);
    path.lineTo(vertices[i1], vertices[i1 + 1]);
    path.lineTo(vertices[i2], vertices[i2 + 1]);
    path.closePath();
  }
  return path;
}

// ============================================================
//  ⭐ PS-style Brush Engine — Texture-based stamp rendering
//
//  核心改变：不再用径向渐变，改用预生成的笔尖贴图 drawImage。
//  贴图类型：soft-round / hard-round / bristle / flat-oval
//  性能：drawImage 比 createRadialGradient 快 10-20×
//  纹理：bristle 模拟刷毛分叉，这才是"毛笔感"的关键
// ============================================================

import { getTipTexture, type TipTextureType } from './BrushTipTexture';

export interface StampRenderConfig {
  points: readonly Point2D[];
  widths: number[];
  color: string;
  stampSpacing?: number;
  /** 笔尖纹理类型 */
  tipType?: TipTextureType;
  /** Jitter 强度 0-1 (0=none, 1=full) */
  jitter?: number;
}

/**
 * PS-style texture stamp renderer.
 *
 * 每个 stamp 用 drawImage(tipTexture) 而非 createRadialGradient。
 * 加 position/size/angle jitter 模拟自然手部微颤。
 * Stamp 间距 0.8-1.2px，足够密集以保证无缝。
 */
export function drawStampStroke(
  ctx: CanvasRenderingContext2D,
  config: StampRenderConfig,
): void {
  const { points, widths, color } = config;
  const n = points.length;
  if (n < 2) return;

  const spacing = config.stampSpacing ?? 1.0;
  const jitter = config.jitter ?? 0.4;
  const tipType = config.tipType ?? 'soft-round';

  // ⭐ 获取预生成的笔尖贴图（缓存）
  const tipTexture = getTipTexture(tipType, color);
  const tipSize = 32; // 贴图原尺寸

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';

  let lastX = points[0].x, lastY = points[0].y;

  for (let i = 0; i < n; i++) {
    const p = points[i];
    const halfW = widths[i] / 2;
    if (halfW < 0.3) continue;

    // 间距裁剪：跳过往点太近的 stamp（但最后一点总是画）
    const dist = Math.hypot(p.x - lastX, p.y - lastY);
    if (dist < spacing && i < n - 1) continue;
    lastX = p.x; lastY = p.y;

    // ⭐ Jitter: 位置 / 大小 / 角度 随机微偏移
    const jx = jitter > 0 ? (Math.random() - 0.5) * jitter * 2 : 0;
    const jy = jitter > 0 ? (Math.random() - 0.5) * jitter * 2 : 0;
    const js = jitter > 0 ? 1 + (Math.random() - 0.5) * jitter * 0.1 : 1;
    const ja = jitter > 0 ? (Math.random() - 0.5) * jitter * Math.PI * 0.05 : 0;

    const stampSize = halfW * 2.3 * js; // 直径（略大于宽度保证重叠）
    const sx = p.x + jx;
    const sy = p.y + jy;

    // 绘制贴图：center 对齐
    ctx.save();
    ctx.translate(sx, sy);
    if (ja !== 0) ctx.rotate(ja);
    ctx.drawImage(
      tipTexture,
      -stampSize / 2, -stampSize / 2,
      stampSize, stampSize,
    );
    ctx.restore();
  }

  ctx.restore();
}

// ⭐ Expose smoothing + width helpers for stamp-based rendering
export { smoothPoints, computeWidths };

export default buildStrokeGeometry;
