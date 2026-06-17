// ============================================================
//  Font Style System — 字体风格定义与目标生成
//
//  核心思路：
//  1. 每种字体风格定义一组"美学规则"
//  2. 对已有手写笔画施加风格化变换，生成目标位置
//  3. 不需要 OCR，不识别字是什么 —— 只做几何变换
//
//  字体风格：
//  🟡 roundCute   — 圆形可爱体：圆角、均匀粗细、略胖比例
//  🔵 kaiShu      — 正楷：棱角分明、横细竖粗、结构端正
//  🟢 xingShu     — 行书：流动感、适度连笔、笔锋渐变
//  🔴 caoShu      — 草书：极度流动、大幅变形、笔锋夸张
// ============================================================

import { beautifyStroke, beautifyWidths } from './StrokeBeautifyEngine';
import type { BeautifyConfig } from './StrokeBeautifyEngine';

// ============================================================
//  Types
// ============================================================

export type FontStyleId = 'roundCute' | 'kaiShu' | 'xingShu' | 'caoShu';

export interface FontStyleDefinition {
  id: FontStyleId;
  name: string;
  /** Human-readable description */
  description: string;
  /** Beautify config override — per-stroke smoothing parameters */
  beautify: Partial<BeautifyConfig>;
  /** Character-level transformation rules */
  character: CharacterStyleRules;
}

export interface CharacterStyleRules {
  /** Target aspect ratio (w/h). 1.0 = square. <1 = tall, >1 = wide. */
  targetAspectRatio: number;
  /** How aggressively to normalize aspect ratio (0-1) */
  aspectRatioStrength: number;
  /** Center alignment strength (0-1) */
  centerAlignStrength: number;
  /** Corner rounding: 0 = sharp, 1 = fully rounded */
  cornerRounding: number;
  /** Stroke width uniformity: 0 = variable (calligraphic), 1 = uniform (marker) */
  widthUniformity: number;
  /** Base width multiplier for target stroke thickness */
  widthScale: number;
  /** Taper amount at stroke ends: 0 = none, 1 = sharp point */
  taperAmount: number;
  /** Horizontal stroke width ratio (for 楷书: 横细竖粗) */
  horizontalWidthRatio: number;
  /** Vertical stroke width ratio (for 楷书: 横细竖粗) */
  verticalWidthRatio: number;
  /** Organic noise amplitude during animation (px) */
  organicNoise: number;
  /** Spring stiffness for animation (higher = faster snap) */
  springStiffness: number;
  /** Spring damping for animation (higher = less bounce) */
  springDamping: number;
  /** Animation duration target (ms) */
  animationDurationMs: number;
}

// ============================================================
//  Font Style Definitions
// ============================================================

export const FONT_STYLES: Record<FontStyleId, FontStyleDefinition> = {
  // ────────────────────────────────────────
  //  圆形可爱体 — 圆润、均匀、萌系
  // ────────────────────────────────────────
  roundCute: {
    id: 'roundCute',
    name: '圆形可爱体',
    description: '圆润可爱，粗细均匀，像糖果一样甜美',
    beautify: {
      strength: 0.65,
      smoothing: 0.55,
      streamline: 0.45,
      straightenR2: 0.92,
      straightenMaxCurve: 0.5,
      pcaMaxAngle: 0.08,
      taperLength: 2,
      taperMinRatio: 0.6,
      uniformWidth: 0, // set via widthScale
    },
    character: {
      targetAspectRatio: 0.95,
      aspectRatioStrength: 0.55,
      centerAlignStrength: 0.7,
      cornerRounding: 0.85,
      widthUniformity: 0.9,
      widthScale: 1.15,
      taperAmount: 0.15,
      horizontalWidthRatio: 1.0,
      verticalWidthRatio: 1.0,
      organicNoise: 1.8,
      springStiffness: 0.06,
      springDamping: 0.82,
      animationDurationMs: 1000,
    },
  },

  // ────────────────────────────────────────
  //  正楷 — 端庄、结构分明、横细竖粗
  // ────────────────────────────────────────
  kaiShu: {
    id: 'kaiShu',
    name: '正楷',
    description: '端庄工整，横细竖粗，棱角分明',
    beautify: {
      strength: 0.55,
      smoothing: 0.3,
      streamline: 0.25,
      straightenR2: 0.97,
      straightenMaxCurve: 0.35,
      pcaMaxAngle: 0.04,
      taperLength: 4,
      taperMinRatio: 0.3,
      uniformWidth: 0,
    },
    character: {
      targetAspectRatio: 0.9,
      aspectRatioStrength: 0.7,
      centerAlignStrength: 0.85,
      cornerRounding: 0.1,
      widthUniformity: 0.2,
      widthScale: 1.0,
      taperAmount: 0.55,
      horizontalWidthRatio: 0.65,
      verticalWidthRatio: 1.35,
      organicNoise: 0.6,
      springStiffness: 0.1,
      springDamping: 0.88,
      animationDurationMs: 800,
    },
  },

  // ────────────────────────────────────────
  //  行书 — 流动、连笔感、笔锋自然
  // ────────────────────────────────────────
  xingShu: {
    id: 'xingShu',
    name: '行书',
    description: '行云流水，笔意连贯，自然洒脱',
    beautify: {
      strength: 0.5,
      smoothing: 0.4,
      streamline: 0.5,
      straightenR2: 0.94,
      straightenMaxCurve: 0.55,
      pcaMaxAngle: 0.05,
      taperLength: 3,
      taperMinRatio: 0.25,
      uniformWidth: 0,
    },
    character: {
      targetAspectRatio: 0.85,
      aspectRatioStrength: 0.5,
      centerAlignStrength: 0.6,
      cornerRounding: 0.45,
      widthUniformity: 0.35,
      widthScale: 1.05,
      taperAmount: 0.45,
      horizontalWidthRatio: 0.8,
      verticalWidthRatio: 1.2,
      organicNoise: 1.2,
      springStiffness: 0.07,
      springDamping: 0.84,
      animationDurationMs: 900,
    },
  },

  // ────────────────────────────────────────
  //  草书 — 极度流动、大幅变形、狂放
  // ────────────────────────────────────────
  caoShu: {
    id: 'caoShu',
    name: '草书',
    description: '狂放不羁，大江东去，笔走龙蛇',
    beautify: {
      strength: 0.7,
      smoothing: 0.6,
      streamline: 0.65,
      straightenR2: 0.88,
      straightenMaxCurve: 0.9,
      pcaMaxAngle: 0.1,
      taperLength: 6,
      taperMinRatio: 0.15,
      uniformWidth: 0,
    },
    character: {
      targetAspectRatio: 0.75,
      aspectRatioStrength: 0.4,
      centerAlignStrength: 0.4,
      cornerRounding: 0.7,
      widthUniformity: 0.15,
      widthScale: 0.95,
      taperAmount: 0.75,
      horizontalWidthRatio: 0.5,
      verticalWidthRatio: 1.5,
      organicNoise: 2.5,
      springStiffness: 0.04,
      springDamping: 0.78,
      animationDurationMs: 1200,
    },
  },
};

// ============================================================
//  Stroke Target Generator
// ============================================================

export interface TargetStrokeData {
  strokeId: string;
  originalPoints: { x: number; y: number }[];
  targetPoints: { x: number; y: number }[];
  targetWidths: number[];
  /** Direction classification per point: 'h' (horizontal), 'v' (vertical), 'd' (diagonal) */
  directions?: Array<'h' | 'v' | 'd'>;
}

/**
 * Generate target stroke data from original strokes using a font style.
 * This creates the "ideal" version of each stroke that the animation will crawl toward.
 */
export function generateTargetStrokes(
  strokes: Array<{
    id: string;
    points: { x: number; y: number; t?: number }[];
    width?: number;
  }>,
  style: FontStyleDefinition,
  baseBeautifyConfig: BeautifyConfig,
): TargetStrokeData[] {
  const results: TargetStrokeData[] = [];

  // Merge base config with style overrides
  const mergedConfig: BeautifyConfig = { ...baseBeautifyConfig, ...style.beautify };

  for (const s of strokes) {
    if (s.points.length < 2) {
      results.push({
        strokeId: s.id,
        originalPoints: s.points.map(p => ({ x: p.x, y: p.y })),
        targetPoints: s.points.map(p => ({ x: p.x, y: p.y })),
        targetWidths: s.points.map(() => s.width ?? 2),
      });
      continue;
    }

    // Deep copy original points
    const originalPts = s.points.map(p => ({ x: p.x, y: p.y }));

    // ① Apply per-stroke beautify with style-specific config
    const beautifiedPts = beautifyStroke(originalPts, mergedConfig);

    // ② Classify stroke direction for width modulation
    const directions = classifyStrokeDirection(beautifiedPts);

    // ③ Compute target widths with calligraphic profile
    const baseWidth = s.width ?? 2;
    const scaledWidth = baseWidth * style.character.widthScale;
    const targetWidths = computeCalligraphicWidths(
      beautifiedPts,
      directions,
      scaledWidth,
      style.character,
    );

    results.push({
      strokeId: s.id,
      originalPoints: originalPts,
      targetPoints: beautifiedPts,
      targetWidths,
      directions,
    });
  }

  return results;
}

// ============================================================
//  Direction Classification
// ============================================================

/** Classify each point's local direction as horizontal, vertical, or diagonal. */
function classifyStrokeDirection(
  points: { x: number; y: number }[],
): Array<'h' | 'v' | 'd'> {
  const n = points.length;
  const dirs: Array<'h' | 'v' | 'd'> = new Array(n).fill('d');

  for (let i = 1; i < n; i++) {
    const dx = Math.abs(points[i].x - points[i - 1].x);
    const dy = Math.abs(points[i].y - points[i - 1].y);

    if (dx > dy * 2) {
      dirs[i] = 'h';
      if (i > 0 && dirs[i - 1] === 'd') dirs[i - 1] = 'h';
    } else if (dy > dx * 2) {
      dirs[i] = 'v';
      if (i > 0 && dirs[i - 1] === 'd') dirs[i - 1] = 'v';
    }
  }

  // Smooth: fill isolated 'd' with neighbor direction
  for (let i = 1; i < n - 1; i++) {
    if (dirs[i] === 'd' && dirs[i - 1] === dirs[i + 1] && dirs[i - 1] !== 'd') {
      dirs[i] = dirs[i - 1];
    }
  }

  return dirs;
}

// ============================================================
//  Calligraphic Width Computation
// ============================================================

function computeCalligraphicWidths(
  points: { x: number; y: number }[],
  directions: Array<'h' | 'v' | 'd'>,
  baseWidth: number,
  rules: CharacterStyleRules,
): number[] {
  const n = points.length;
  const widths: number[] = new Array(n);

  for (let i = 0; i < n; i++) {
    let widthRatio: number;

    switch (directions[i]) {
      case 'h':
        widthRatio = rules.horizontalWidthRatio;
        break;
      case 'v':
        widthRatio = rules.verticalWidthRatio;
        break;
      default:
        widthRatio = (rules.horizontalWidthRatio + rules.verticalWidthRatio) / 2;
        break;
    }

    // Blend with uniformity target
    const uniformBlend = rules.widthUniformity;
    widthRatio = widthRatio * (1 - uniformBlend) + 1.0 * uniformBlend;

    widths[i] = Math.max(0.3, baseWidth * widthRatio);
  }

  // Apply taper at ends
  applyCalligraphicTaper(widths, rules.taperAmount, n);

  return widths;
}

function applyCalligraphicTaper(
  widths: number[],
  taperAmount: number,
  n: number,
): void {
  if (taperAmount <= 0 || n < 4) return;

  const tl = Math.min(Math.floor(n / 3), Math.floor(n * 0.25));
  if (tl < 1) return;

  const minRatio = 1 - taperAmount;

  for (let i = 0; i < tl; i++) {
    const t = i / tl;
    const ease = t * t; // quadratic ease-in for natural taper
    widths[i] *= minRatio + (1 - minRatio) * ease;
  }

  for (let i = 0; i < tl; i++) {
    const t = i / tl;
    const ease = t * t;
    widths[n - tl + i] *= 1 - (1 - minRatio) * ease;
  }
}

// ============================================================
//  Bounding Box Utilities
// ============================================================

export interface CharacterBBox {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

export function computeBBox(
  strokes: Array<{ points: { x: number; y: number }[] }>,
): CharacterBBox {
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const s of strokes) {
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

// ============================================================
//  Convenience
// ============================================================

export function getFontStyle(id: FontStyleId): FontStyleDefinition {
  return FONT_STYLES[id];
}

export function getAllFontStyles(): FontStyleDefinition[] {
  return Object.values(FONT_STYLES);
}
