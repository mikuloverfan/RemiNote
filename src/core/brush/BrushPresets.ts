// ============================================================
//  Brush Presets — 预设 Brush 配置集合
//
//  当前已清理到最小预设集：
//  - brush-pen : 毛笔（当前激活）
//  - ps-default: PS 默认笔刷（预留槽位，下一阶段实现）
//
//  移除的旧预设：pen-ps, pencil, fountain-pen, marker, ballpoint, highlighter
// ============================================================

import type { Brush } from './BrushModel';
import { createBrush } from './BrushModel';

// ============================================================
//  Preset Definitions
// ============================================================

/**
 * Brush Pen — 毛笔
 *
 * 为 RemiNote 三角形 mesh 渲染优化的毛笔预设。
 * 特点：
 * - smoothstep 起收笔（taper 0.7）
 * - 低硬度 → 边缘柔和
 * - 已调至可用状态
 *
 * 配合当前 main.ts 中的 buildStrokeGeometry 配置：
 *   taper: 0.7, minWidth: 0.02, maxWidth: 1.4, edgeBlur: 0.3
 */
const BRUSH_PEN: Readonly<Brush> = createBrush({
  id: 'brush-pen',
  size: 3.5,
  hardness: 0.3,
  smoothing: 0.6,
  velocitySensitivity: 0.5,
  pressureCurve: 1.6,
  taperStart: 0.7,
  taperEnd: 0.7,
  widthProfile: 'brush',
  grainIntensity: 0,
  flow: 0.3,
});

/**
 * ⏳ PS Default — PS 默认笔刷预留槽位
 *
 * PS 软边圆笔刷（默认笔刷，有压感时）的感觉描述：
 *
 * 有压感时，PS 默认笔刷是这样的：
 * - 笔迹是一条**连续饱满的墨水带**，不是一串段
 * - 起笔时：压力从 0 → 迅速升到设定宽度（约 20px 距离），边缘像刀切一样锐利
 * - 书写中：宽度随压力实时变化，轻压 0.3→细、重压 1.0→饱满
 * - 收笔时：压力方向拉收，宽度从饱满 → 逐渐缩到极细，收尾干净利落，不拖泥带水
 * - 边缘：硬中带一点柔（hardness ≈ 0.75），不是羽化模糊，而是"微妙的柔"
 * - 重叠区域：因为 soft 边缘 + multiply 混合，交叉处会自然变深
 * - 速度影响：快的方向宽度略微变细（越感），但不会突然断墨
 *
 * 核心关键字：均匀、饱满、利落、锐利
 *
 * 和毛笔的区别：
 *   毛笔 = 书法感，两头尖中间鼓，边缘柔，速度/压力剧烈变化
 *   PS默认 = 书写感，均匀饱满，起收干脆，边缘锐利微柔
 *
 * 渲染参数待调：
 *   taper: 0.3, minWidth: 0.3, maxWidth: 1.2, edgeBlur: 0.5
 *   → 起笔较快到全宽，收笔利落，中间基本匀速变化
 */
const PS_DEFAULT: Readonly<Brush> = createBrush({
  id: 'ps-default',
  size: 2.5,
  hardness: 0.75,
  smoothing: 0.4,
  velocitySensitivity: 0.35,
  pressureCurve: 1.2,
  taperStart: 0.3,
  taperEnd: 0.3,
  widthProfile: 'pen',
  grainIntensity: 0,
  flow: 0.15,
});

// ============================================================
//  Preset Registry
// ============================================================

/** All built-in presets keyed by ID. */
const BUILT_IN_PRESETS: Record<string, Readonly<Brush>> = {
  [BRUSH_PEN.id]: BRUSH_PEN,
  'ps-default': PS_DEFAULT,
};

// ============================================================
//  BrushPresets API
// ============================================================

export const BrushPresets = {
  /**
   * Get a brush preset by ID.
   * @returns The brush, or undefined if not found.
   */
  get(id: string): Readonly<Brush> | undefined {
    return BUILT_IN_PRESETS[id];
  },

  /**
   * Get the default brush preset (毛笔).
   */
  getDefault(): Readonly<Brush> {
    return BRUSH_PEN;
  },

  /**
   * List all registered brush preset IDs.
   */
  listIds(): string[] {
    return Object.keys(BUILT_IN_PRESETS);
  },

  /**
   * List all registered brush presets.
   */
  listAll(): Readonly<Brush>[] {
    return Object.values(BUILT_IN_PRESETS);
  },

  /**
   * Register a custom brush preset (for UI brush editor).
   * Overwrites if ID already exists.
   */
  register(brush: Readonly<Brush>): void {
    BUILT_IN_PRESETS[brush.id] = brush;
  },

  /**
   * Remove a custom brush preset. Cannot remove built-in presets.
   */
  unregister(id: string): boolean {
    const builtInIds = [
      'brush-pen', 'ps-default',
    ];
    if (builtInIds.includes(id)) {
      return false;
    }
    return delete BUILT_IN_PRESETS[id];
  },
} as const;
