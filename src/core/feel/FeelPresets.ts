// ============================================================
//  Phase 3: Feel Presets — 预定义手感配置
//
//  使用方式：
//    import { FEEL_PRESETS } from './FeelPresets';
//    engine.setFeel(FEEL_PRESETS.smooth);
// ============================================================

import type { FeelConfig } from './FeelConfig';
import { createFeelConfig } from './FeelConfig';

// ============================================================
//  Preset Definitions
// ============================================================

/**
 * Natural — 中性手感，等价于无 Feel Layer。
 * 所有参数 = 1.0，完全由 Brush 决定行为。
 */
const NATURAL: Readonly<FeelConfig> = createFeelConfig({
  microJitter: 1.0,
  velocityDamping: 1.0,
  pressureResponse: 1.0,
  taperCurve: 1.0,
  strokeAdhesion: 1.0,
});

/**
 * Smooth — 平滑手感，减少抖动，速度变化平缓。
 * 适合：长时间书写、笔记记录。
 *
 * 特点：
 * - 微抖动减半 (0.5x)
 * - 速度阻尼加强 (更平滑)
 * - 压力响应稍弱 (线条更均匀)
 * - 起收笔过渡柔和
 */
const SMOOTH: Readonly<FeelConfig> = createFeelConfig({
  microJitter: 0.5,
  velocityDamping: 1.5,
  pressureResponse: 0.8,
  taperCurve: 1.3,
  strokeAdhesion: 1.2,
});

/**
 * Responsive — 响应手感，速度/压力变化敏感。
 * 适合：速写、签名、书法练习。
 *
 * 特点：
 * - 微抖动保持 (1.0x)
 * - 速度阻尼降低 (更灵敏)
 * - 压力响应加强 (粗细对比强)
 * - 起收笔快速响应
 */
const RESPONSIVE: Readonly<FeelConfig> = createFeelConfig({
  microJitter: 1.0,
  velocityDamping: 0.6,
  pressureResponse: 1.4,
  taperCurve: 0.7,
  strokeAdhesion: 0.8,
});

/**
 * Mechanical — 机械手感，极度稳定，零抖动。
 * 适合：工程图、精确划线、标注。
 *
 * 特点：
 * - 微抖动归零 (0x)
 * - 速度阻尼最大 (极平滑)
 * - 压力响应极弱 (恒定宽度)
 * - 无起收笔过渡
 */
const MECHANICAL: Readonly<FeelConfig> = createFeelConfig({
  microJitter: 0.0,
  velocityDamping: 1.8,
  pressureResponse: 0.5,
  taperCurve: 0.3,
  strokeAdhesion: 1.5,
});

/**
 * Sketch — 手绘手感，保留抖动，快速响应。
 * 适合：素描、涂鸦、自由绘画。
 *
 * 特点：
 * - 微抖动加倍 (2.0x, 手工感)
 * - 速度阻尼最低 (即时响应)
 * - 压力响应最强 (极粗/极细)
 * - 起收笔明显
 */
const SKETCH: Readonly<FeelConfig> = createFeelConfig({
  microJitter: 2.0,
  velocityDamping: 0.3,
  pressureResponse: 1.8,
  taperCurve: 1.6,
  strokeAdhesion: 0.4,
});

// ============================================================
//  Registry
// ============================================================

const BUILT_IN_FEELS: Record<string, Readonly<FeelConfig>> = {
  natural: NATURAL,
  smooth: SMOOTH,
  responsive: RESPONSIVE,
  mechanical: MECHANICAL,
  sketch: SKETCH,
};

export const FeelPresets = {
  get(id: string): Readonly<FeelConfig> | undefined {
    return BUILT_IN_FEELS[id];
  },

  getDefault(): Readonly<FeelConfig> {
    return NATURAL;
  },

  listIds(): string[] {
    return Object.keys(BUILT_IN_FEELS);
  },

  listAll(): Readonly<FeelConfig>[] {
    return Object.values(BUILT_IN_FEELS);
  },
} as const;
