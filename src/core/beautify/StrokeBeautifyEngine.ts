// ============================================================
//  Stroke Beautify Engine v4 — perfect-freehand + corner-preserving
//
//  核心思路:
//  1. 检测拐点 (曲率极值)
//  2. 在拐点之间分段用 perfect-freehand 平滑
//  3. 端点锚定原始位置 (防钩子)
//  4. 重采样回原点数
//  5. PCA 弹性回正
//
//  原则:
//  🎯 只在 ✨ 开启时触发，画画不受影响
// ============================================================

import { getStroke, getStrokePoints } from 'perfect-freehand';

// ============================================================
//  Types
// ============================================================

export interface BeautifyConfig {
  enabled: boolean;
  strength: number;
  smoothing: number;
  streamline: number;
  straightenR2: number;
  straightenMinPoints: number;
  /** Maximum total curvature (radians) to still consider a segment "straight". Curves above this are preserved. */
  straightenMaxCurve: number;
  uniformWidth: number;
  taperLength: number;
  taperMinRatio: number;
  pcaMaxAngle: number;
  /** Redraw: after last stroke ends, wait this many ms then re-optimize ALL strokes. 0 = disabled. */
  redrawDelayMs: number;
}

export const DEFAULT_BEAUTIFY_CONFIG: BeautifyConfig = {
  enabled: false,
  strength: 0.5,
  smoothing: 0.35,
  streamline: 0.35,
  straightenR2: 0.96,
  straightenMinPoints: 5,
  straightenMaxCurve: 0.8,
  uniformWidth: 0,
  taperLength: 4,
  taperMinRatio: 0.35,
  pcaMaxAngle: 0.06,
  redrawDelayMs: 0,
};

// ============================================================
//  Pipeline
// ============================================================

export function beautifyStroke(
  points: { x: number; y: number }[],
  config: BeautifyConfig,
): { x: number; y: number }[] {
  if (points.length < 3) return points;

  const s = config.strength;
  const n = points.length;

  // ① Detect corners
  const corners = detectCorners(points, 0.55);

  // ② Adaptive curvature-aware smoothing between corners
  const smoothed: { x: number; y: number }[] = [];

  for (let c = 0; c < corners.length - 1; c++) {
    const seg = points.slice(corners[c], corners[c + 1] + 1);
    if (seg.length < 2) {
      smoothed.push(...seg);
      continue;
    }

    // Adaptive smoothing: split by curvature, apply different smoothing per sub-segment
    const segSmoothed = adaptiveSmoothSegment(seg, config.smoothing * s, config.streamline * s);
    smoothed.push(...segSmoothed);
  }

  if (smoothed.length === 0) return points;

  // ③ Resample to original count
  let result = resamplePath(smoothed, n);

  // ④ ⭐ Light PCA only — no aggressive straightening (preserve natural curves)
  if (s > 0.6 && result.length > 8) {
    // Use very small maxAngle to avoid distorting curves
    const pcaMax = config.pcaMaxAngle * s * 0.3;
    result = pcaAlign(result, Math.min(pcaMax, 0.03));
  }

  return result;
}

export function beautifyWidths(
  points: { x: number; y: number }[],
  config: BeautifyConfig,
  baseWidth: number,
): number[] {
  const n = points.length;
  if (n === 0) return [];
  const widths: number[] = new Array(n);
  if (config.uniformWidth > 0) {
    for (let i = 0; i < n; i++) widths[i] = config.uniformWidth;
  } else {
    for (let i = 0; i < n; i++) widths[i] = baseWidth;
  }
  if (config.taperLength > 0 && n > config.taperLength * 2) {
    applyTaper(widths, config.taperLength, config.taperMinRatio);
  }
  return widths;
}

// ============================================================
//  Corner detection
// ============================================================

function detectCorners(points: { x: number; y: number }[], threshold: number): number[] {
  const n = points.length;
  if (n < 5) return [0, n - 1];

  const corners: number[] = [0];
  const curvatures: number[] = new Array(n).fill(0);

  for (let i = 2; i < n - 2; i++) {
    const dx1 = points[i].x - points[i - 2].x, dy1 = points[i].y - points[i - 2].y;
    const dx2 = points[i + 2].x - points[i].x, dy2 = points[i + 2].y - points[i].y;
    const l1 = Math.hypot(dx1, dy1), l2 = Math.hypot(dx2, dy2);
    if (l1 < 0.01 || l2 < 0.01) continue;
    const dot = (dx1 * dx2 + dy1 * dy2) / (l1 * l2);
    curvatures[i] = Math.acos(Math.max(-1, Math.min(1, dot)));
  }

  for (let i = 2; i < n - 2; i++) {
    if (curvatures[i] > threshold &&
        curvatures[i] >= curvatures[i - 1] &&
        curvatures[i] >= curvatures[i - 2] &&
        curvatures[i] >= curvatures[i + 1] &&
        curvatures[i] >= curvatures[i + 2]) {
      if (i - corners[corners.length - 1] >= 4) corners.push(i);
    }
  }

  if (corners[corners.length - 1] !== n - 1) corners.push(n - 1);
  return corners;
}

// ============================================================
//  Segment smoothing (perfect-freehand)
// ============================================================

function adaptiveSmoothSegment(
  seg: { x: number; y: number }[],
  baseSmoothing: number,
  baseStreamline: number,
): { x: number; y: number }[] {
  if (seg.length < 3) return seg;

  const first = seg[0];
  const last = seg[seg.length - 1];

  try {
    // Compute curvature profile: per-point curvature (0=straight, >0=curved)
    const curvatures = computeCurvatureProfile(seg);

    // Classify each point: straight (<0.2), curve (0.2-0.6), sharp (>0.6)
    // Then split into contiguous regions of same class
    const regions = splitByCurvature(seg, curvatures);

    // Smooth each region with appropriate strength
    const result: { x: number; y: number }[] = [];
    for (const region of regions) {
      if (region.points.length < 2) {
        result.push(...region.points);
        continue;
      }

      // curvatureFactor: 0=straight(high smoothing), 1=sharp(low smoothing)
      const cf = region.avgCurvature;
      const smoothing = baseSmoothing * (1 - cf * 0.7);  // 0.3-1.0x
      const streamline = baseStreamline * (1 - cf * 0.5);

      const opts = {
        size: 1, thinning: 0,
        smoothing: Math.max(0.1, Math.min(1, smoothing)),
        streamline: Math.max(0.1, Math.min(1, streamline)),
        simulatePressure: true, last: true,
      };

      const strokePts = getStrokePoints(
        region.points as Array<{ x: number; y: number; pressure?: number }>,
        opts,
      );
      if (strokePts && strokePts.length >= 2) {
        const smoothed = strokePts.map((sp: { point: number[] }) => ({
          x: sp.point[0], y: sp.point[1],
        }));
        result.push(...smoothed);
      } else {
        result.push(...region.points);
      }
    }

    // Anchor endpoints
    if (result.length >= 2) {
      result[0] = { x: first.x, y: first.y };
      result[result.length - 1] = { x: last.x, y: last.y };
    }

    return result;
  } catch {
    return seg;
  }
}

/** Per-point local curvature using 3-point angle. Returns values in [0, ~PI]. */
function computeCurvatureProfile(points: { x: number; y: number }[]): number[] {
  const n = points.length;
  const curv: number[] = new Array(n).fill(0);
  // Use wider window (5 points) for smoother curvature profile
  for (let i = 2; i < n - 2; i++) {
    const dx1 = points[i].x - points[i - 2].x, dy1 = points[i].y - points[i - 2].y;
    const dx2 = points[i + 2].x - points[i].x, dy2 = points[i + 2].y - points[i].y;
    const l1 = Math.hypot(dx1, dy1), l2 = Math.hypot(dx2, dy2);
    if (l1 < 0.5 || l2 < 0.5) continue;
    const dot = (dx1 * dx2 + dy1 * dy2) / (l1 * l2);
    curv[i] = Math.acos(Math.max(-1, Math.min(1, dot))) / Math.PI; // Normalize to [0,1]
  }
  // Fill endpoints from neighbors
  for (let i = 0; i < 2 && i < n; i++) curv[i] = curv[2] ?? 0;
  for (let i = n - 2; i < n; i++) curv[i] = curv[n - 3] ?? 0;
  return curv;
}

interface CurvatureRegion {
  points: { x: number; y: number }[];
  avgCurvature: number;
}

/** Split points into contiguous regions of similar curvature. */
function splitByCurvature(
  points: { x: number; y: number }[],
  curvatures: number[],
): CurvatureRegion[] {
  const n = points.length;
  if (n === 0) return [];

  const regions: CurvatureRegion[] = [];
  let start = 0;
  let sumC = curvatures[0];

  for (let i = 1; i < n; i++) {
    // If curvature changes significantly, split
    if (Math.abs(curvatures[i] - curvatures[i - 1]) > 0.3) {
      regions.push({
        points: points.slice(start, i),
        avgCurvature: sumC / (i - start),
      });
      start = i;
      sumC = 0;
    }
    sumC += curvatures[i];
  }

  // Final region
  regions.push({
    points: points.slice(start),
    avgCurvature: sumC / (n - start),
  });

  return regions;
}

// ============================================================
//  Resampling
// ============================================================

function resamplePath(points: { x: number; y: number }[], n: number): { x: number; y: number }[] {
  if (n < 2 || points.length < 2) return points;

  const dists: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    dists.push(dists[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const total = dists[dists.length - 1];
  if (total < 0.001) return points;

  const result: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const target = (i / (n - 1)) * total;
    let lo = 0, hi = dists.length - 1;
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (dists[mid] < target) lo = mid + 1; else hi = mid; }
    const idx = Math.max(1, lo);
    const segLen = dists[idx] - dists[idx - 1];
    const t = segLen > 0 ? (target - dists[idx - 1]) / segLen : 0;
    result.push({
      x: points[idx - 1].x + (points[idx].x - points[idx - 1].x) * t,
      y: points[idx - 1].y + (points[idx].y - points[idx - 1].y) * t,
    });
  }
  return result;
}

// ============================================================
//  Straighten
// ============================================================

function straightenSegments(points: { x: number; y: number }[], r2Threshold: number, minPoints: number, strength: number, maxCurve: number = 0.8): { x: number; y: number }[] {
  const n = points.length;
  if (n < minPoints) return points;
  const result = points.map(p => ({ x: p.x, y: p.y }));
  let start = 0;
  while (start < n - minPoints) {
    let bestEnd = start + minPoints;
    for (let end = start + minPoints; end <= Math.min(n, start + 30); end++) {
      const seg = points.slice(start, end);
      const r2 = computeR2(seg);
      const curve = totalCurvature(seg);
      if (r2 >= r2Threshold && curve < maxCurve) bestEnd = end;
      else if (end - start > minPoints) break;
    }
    if (bestEnd > start + minPoints) {
      const sx = points[start].x, sy = points[start].y;
      const ex = points[bestEnd - 1].x, ey = points[bestEnd - 1].y;
      for (let i = start; i < bestEnd; i++) {
        const t = (i - start) / Math.max(1, bestEnd - start - 1);
        result[i] = { x: points[i].x + (sx + (ex - sx) * t - points[i].x) * strength, y: points[i].y + (sy + (ey - sy) * t - points[i].y) * strength };
      }
      start = bestEnd;
    } else start++;
  }
  return result;
}

function totalCurvature(points: { x: number; y: number }[]): number {
  if (points.length < 3) return 0;
  let total = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const dx1 = points[i].x - points[i - 1].x, dy1 = points[i].y - points[i - 1].y;
    const dx2 = points[i + 1].x - points[i].x, dy2 = points[i + 1].y - points[i].y;
    const l1 = Math.hypot(dx1, dy1), l2 = Math.hypot(dx2, dy2);
    if (l1 < 0.01 || l2 < 0.01) continue;
    const dot = (dx1 * dx2 + dy1 * dy2) / (l1 * l2);
    total += Math.acos(Math.max(-1, Math.min(1, dot)));
  }
  return total;
}

function computeR2(points: { x: number; y: number }[]): number {
  const n = points.length;
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0;
  for (const p of points) { sx += p.x; sy += p.y; sxy += p.x * p.y; sx2 += p.x * p.x; sy2 += p.y * p.y; }
  const dx = n * sx2 - sx * sx, dy = n * sy2 - sy * sy;
  if (dx < 1e-9 || dy < 1e-9) return 1;
  const r = (n * sxy - sx * sy) / Math.sqrt(dx * dy);
  return r * r;
}

// ============================================================
//  PCA
// ============================================================

function pcaAlign(points: { x: number; y: number }[], maxAngle: number): { x: number; y: number }[] {
  const n = points.length;
  if (n < 3) return points;
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;
  let covXX = 0, covXY = 0, covYY = 0;
  for (const p of points) { const dx = p.x - cx, dy = p.y - cy; covXX += dx * dx; covXY += dx * dy; covYY += dy * dy; }
  const angle = 0.5 * Math.atan2(2 * covXY, covXX - covYY);
  const aMod = ((angle % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
  let target = 0;
  if (aMod > Math.PI / 4) target = angle > 0 ? Math.PI / 2 - aMod : -(Math.PI / 2 - aMod);
  const correction = Math.max(-maxAngle, Math.min(maxAngle, target));
  if (Math.abs(correction) < 0.001) return points;
  const cos = Math.cos(correction), sin = Math.sin(correction);
  const result: { x: number; y: number }[] = new Array(n);
  for (let i = 0; i < n; i++) { const dx = points[i].x - cx, dy = points[i].y - cy; result[i] = { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }; }
  return result;
}

// ============================================================
//  Taper
// ============================================================

function applyTaper(widths: number[], taperLength: number, minRatio: number): void {
  const n = widths.length;
  if (n < taperLength * 3) return;
  const tl = Math.min(taperLength, Math.floor(n / 3));
  for (let i = 0; i < tl; i++) { const t = i / tl; widths[i] *= minRatio + (1 - minRatio) * t; }
  for (let i = 0; i < tl; i++) { const t = i / tl; widths[n - tl + i] *= 1 - (1 - minRatio) * t; }
}

// ============================================================
//  Convenience
// ============================================================

export function strengthToConfig(strength: number): Partial<BeautifyConfig> {
  const s = Math.max(0, Math.min(1, strength));
  return {
    strength: s,
    smoothing: 0.3 + s * 0.5,
    streamline: 0.3 + s * 0.5,
    straightenR2: 0.99 - s * 0.1,
    taperLength: Math.round(2 + s * 6),
    taperMinRatio: 0.5 - s * 0.35,
    pcaMaxAngle: s * 0.06,
    redrawDelayMs: 0,
    straightenMaxCurve: 1.2 - s * 0.8,
  };
}

// ============================================================
//  v5: Aggressive Geometric Beautification
//  — 方向量化 + 宽度统一 + 角点重塑 + 端点风格
// ============================================================

import type { FontStyleId, CharacterStyleRules } from './FontStyleSystem';
import { FONT_STYLES } from './FontStyleSystem';

export interface AggressiveBeautifyResult {
  points: { x: number; y: number }[];
  widths: number[];
}

/** Apply aggressive font-style geometric transformation to a single stroke. */
export function aggressiveBeautifyStroke(
  points: { x: number; y: number }[],
  styleId: FontStyleId,
  baseWidth: number,
): AggressiveBeautifyResult {
  if (points.length < 2) {
    return { points: [...points], widths: [baseWidth] };
  }

  const rules = FONT_STYLES[styleId].character;
  let pts = [...points];

  // ① Simplify: reduce to key points via RDP
  pts = simplifyRDP(pts, 3.0);

  // ② Direction quantization: snap segment angles to preferred directions
  pts = quantizeDirections(pts, rules);

  // ③ Corner reshaping: round or sharpen based on style
  pts = reshapeCorners(pts, rules);

  // ④ Smooth the quantized path for natural curves
  pts = smoothPath(pts, 3);

  // ⑤ Resample to original point count for consistency
  pts = resampleToCount(pts, Math.max(points.length, 15));

  // ⑥ Compute calligraphic widths
  const widths = computeStyleWidths(pts, rules, baseWidth);

  return { points: pts, widths };
}

/** RDP simplification. */
function simplifyRDP(
  pts: { x: number; y: number }[],
  epsilon: number,
): { x: number; y: number }[] {
  if (pts.length <= 2) return pts;

  let maxDist = 0, maxIdx = 0;
  const first = pts[0], last = pts[pts.length - 1];
  const dx = last.x - first.x, dy = last.y - first.y;
  const lenSq = dx * dx + dy * dy;

  for (let i = 1; i < pts.length - 1; i++) {
    let dist: number;
    if (lenSq < 0.001) {
      dist = Math.hypot(pts[i].x - first.x, pts[i].y - first.y);
    } else {
      const t = ((pts[i].x - first.x) * dx + (pts[i].y - first.y) * dy) / lenSq;
      dist = Math.hypot(pts[i].x - (first.x + t * dx), pts[i].y - (first.y + t * dy));
    }
    if (dist > maxDist) { maxDist = dist; maxIdx = i; }
  }

  if (maxDist <= epsilon) return [first, last];

  const left = simplifyRDP(pts.slice(0, maxIdx + 1), epsilon);
  const right = simplifyRDP(pts.slice(maxIdx), epsilon);
  return [...left.slice(0, -1), ...right];
}

/** Quantize segment directions to preferred angles. */
function quantizeDirections(
  pts: { x: number; y: number }[],
  rules: CharacterStyleRules,
): { x: number; y: number }[] {
  if (pts.length < 2) return pts;

  // Preferred angles based on rounding level
  const roundLevel = rules.cornerRounding;
  let preferredAngles: number[];

  if (roundLevel > 0.6) {
    // roundCute / caoShu: allow any direction (no quantization)
    return pts;
  } else if (roundLevel > 0.3) {
    // xingShu: 8 directions
    preferredAngles = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, -3 * Math.PI / 4, -Math.PI / 2, -Math.PI / 4];
  } else {
    // kaiShu: strict 4 directions
    preferredAngles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  }

  const result = [pts[0]];
  let cx = pts[0].x, cy = pts[0].y;

  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) continue;

    const angle = Math.atan2(dy, dx);
    // Find nearest preferred angle
    let bestAngle = angle;
    let bestDiff = Infinity;
    for (const pa of preferredAngles) {
      let diff = Math.abs(angle - pa);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff < bestDiff) { bestDiff = diff; bestAngle = pa; }
    }

    // Blend toward preferred angle (strength based on 1 - roundLevel)
    const blend = 1 - roundLevel;
    const finalAngle = angle + (bestAngle - angle) * blend;

    cx += Math.cos(finalAngle) * dist;
    cy += Math.sin(finalAngle) * dist;
    result.push({ x: cx, y: cy });
  }

  return result;
}

/** Reshape corners: round (bezier) or sharpen based on style. */
function reshapeCorners(
  pts: { x: number; y: number }[],
  rules: CharacterStyleRules,
): { x: number; y: number }[] {
  if (pts.length < 3) return pts;

  const result: { x: number; y: number }[] = [pts[0]];
  const roundLevel = rules.cornerRounding;

  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = pts[i + 1];

    const dx1 = curr.x - prev.x, dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x, dy2 = next.y - curr.y;
    const d1 = Math.hypot(dx1, dy1);
    const d2 = Math.hypot(dx2, dy2);

    if (d1 < 0.5 || d2 < 0.5) {
      result.push(curr);
      continue;
    }

    const angle = Math.acos(Math.max(-1, Math.min(1, (dx1 * dx2 + dy1 * dy2) / (d1 * d2))));

    if (angle > 0.3) {
      // This is a corner — apply rounding
      if (roundLevel > 0.5) {
        // Round corner: insert bezier control points
        const r = Math.min(d1, d2) * roundLevel * 0.4;
        const cp1x = curr.x - (dx1 / d1) * r;
        const cp1y = curr.y - (dy1 / d1) * r;
        const cp2x = curr.x + (dx2 / d2) * r;
        const cp2y = curr.y + (dy2 / d2) * r;
        // Add interpolated points for rounded corner
        const steps = Math.ceil(angle / 0.3);
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const bx = (1 - t) * (1 - t) * cp1x + 2 * (1 - t) * t * curr.x + t * t * cp2x;
          const by = (1 - t) * (1 - t) * cp1y + 2 * (1 - t) * t * curr.y + t * t * cp2y;
          result.push({ x: bx, y: by });
        }
      } else {
        // Sharp corner: keep as-is
        result.push(curr);
      }
    } else {
      // Not a corner: keep as-is
      result.push(curr);
    }
  }

  result.push(pts[pts.length - 1]);
  return result;
}

/** Simple moving average smoothing. */
function smoothPath(pts: { x: number; y: number }[], passes: number): { x: number; y: number }[] {
  for (let p = 0; p < passes; p++) {
    const smoothed = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      smoothed.push({
        x: (pts[i - 1].x + pts[i].x + pts[i + 1].x) / 3,
        y: (pts[i - 1].y + pts[i].y + pts[i + 1].y) / 3,
      });
    }
    smoothed.push(pts[pts.length - 1]);
    pts = smoothed;
  }
  return pts;
}

/** Resample path to target point count. */
function resampleToCount(pts: { x: number; y: number }[], targetCount: number): { x: number; y: number }[] {
  if (pts.length < 2 || targetCount < 2) return pts;

  const dists: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    dists.push(dists[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = dists[dists.length - 1];
  if (total < 0.001) return [pts[0], pts[pts.length - 1]];

  const result: { x: number; y: number }[] = [];
  for (let i = 0; i < targetCount; i++) {
    const t = (i / (targetCount - 1)) * total;
    let lo = 0, hi = dists.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (dists[mid] < t) lo = mid + 1; else hi = mid; }
    const idx = Math.max(1, lo);
    const seg = dists[idx] - dists[idx - 1];
    const frac = seg > 0 ? (t - dists[idx - 1]) / seg : 0;
    result.push({
      x: pts[idx - 1].x + (pts[idx].x - pts[idx - 1].x) * frac,
      y: pts[idx - 1].y + (pts[idx].y - pts[idx - 1].y) * frac,
    });
  }
  return result;
}

/** Compute calligraphic widths based on stroke direction and style rules. */
function computeStyleWidths(
  pts: { x: number; y: number }[],
  rules: CharacterStyleRules,
  baseWidth: number,
): number[] {
  const n = pts.length;
  const widths: number[] = new Array(n);

  for (let i = 0; i < n; i++) {
    // Determine local direction
    let angle: number;
    if (i === 0 && n > 1) {
      angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
    } else if (i === n - 1 && n > 1) {
      angle = Math.atan2(pts[n - 1].y - pts[n - 2].y, pts[n - 1].x - pts[n - 2].x);
    } else if (n > 2) {
      angle = Math.atan2(pts[i + 1].y - pts[i - 1].y, pts[i + 1].x - pts[i - 1].x);
    } else {
      angle = 0;
    }

    // Normalize to [0, PI)
    const normAngle = ((Math.abs(angle) % Math.PI) + Math.PI) % Math.PI;

    // Horizontal (near 0 or PI): use horizontal ratio
    // Vertical (near PI/2): use vertical ratio
    const isHorizontal = normAngle < Math.PI / 4 || normAngle > 3 * Math.PI / 4;
    const isVertical = normAngle > Math.PI / 4 && normAngle < 3 * Math.PI / 4;

    let ratio: number;
    if (isHorizontal) {
      ratio = rules.horizontalWidthRatio;
    } else if (isVertical) {
      ratio = rules.verticalWidthRatio;
    } else {
      ratio = (rules.horizontalWidthRatio + rules.verticalWidthRatio) / 2;
    }

    // Blend with uniformity
    ratio = ratio * (1 - rules.widthUniformity) + 1.0 * rules.widthUniformity;

    widths[i] = Math.max(0.3, baseWidth * rules.widthScale * ratio);
  }

  // Apply taper at ends
  applyStyleTaper(widths, rules.taperAmount);

  return widths;
}

function applyStyleTaper(widths: number[], taperAmount: number): void {
  if (taperAmount <= 0 || widths.length < 4) return;
  const tl = Math.min(Math.floor(widths.length / 3), 4);
  if (tl < 1) return;
  const minRatio = 1 - taperAmount;
  for (let i = 0; i < tl; i++) {
    const t = i / tl;
    widths[i] *= minRatio + (1 - minRatio) * (t * t);
  }
  for (let i = 0; i < tl; i++) {
    const t = i / tl;
    widths[widths.length - tl + i] *= 1 - (1 - minRatio) * (t * t);
  }
}

/** Expand a single-point stroke into a punctuation shape. */
export function expandDotToPunctuation(
  point: { x: number; y: number },
  width: number,
): AggressiveBeautifyResult {
  // Create a small comma/period shape (3-4 points in a teardrop)
  const pts = [
    { x: point.x, y: point.y },
    { x: point.x + width * 2, y: point.y + width * 1.5 },
    { x: point.x + width * 0.5, y: point.y + width * 3 },
    { x: point.x - width, y: point.y + width * 1 },
  ];
  const ws = [width * 0.3, width * 0.8, width * 1.2, width * 0.5];
  return { points: pts, widths: ws };
}
