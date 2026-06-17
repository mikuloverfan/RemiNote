// ============================================================
//  Phase 5.9: Standard Brush Products
//
//  4 个标准笔刷产品定义（纯数据）：
//    pen, pencil, marker, watercolor
//
//  每个产品 = 完整 BrushProduct 定义
//  不做逻辑，不做 class，不做 method
// ============================================================

import type { BrushProduct } from './BrushProductSystem';
import { DEFAULT_GPU_PROFILE } from './BrushProductSystem';

// ============================================================
//  1. Pen（钢笔）
//
//  kernel:    sharp pressureCurve (1.6)
//  ink:       low grain (0.12)
//  physics:   minimal smoothing
// ============================================================

export const PEN: BrushProduct = {
  id: 'pen',
  name: 'Pen',
  kernelSpec: {
    pressureCurve: 1.6,
    velocityFactor: 4,
    envelopeSize: 12,
    opacityCurve: 1,
    tipHardness: 0.3,
  },
  inkSpec: {
    grain: 0.12,
    edgeSoftness: 0.2,
    opacityStability: 0.1,
  },
  physicsProfile: {
    velocitySmoothing: 0.8,
    pressureSmoothing: 0.35,
    directionInertia: 0.7,
  },
  gpuProfile: DEFAULT_GPU_PROFILE,
  ui: {
    previewColor: '#1a1a1a',
    icon: 'pen',
  },
};

// ============================================================
//  2. Pencil（铅笔）
//
//  kernel:    noisy pressure (1.2) + light velocity factor
//  ink:       high grain (0.35)
//  physics:   slight jitter
// ============================================================

export const PENCIL: BrushProduct = {
  id: 'pencil',
  name: 'Pencil',
  kernelSpec: {
    pressureCurve: 1.2,
    velocityFactor: 3,
    envelopeSize: 10,
    opacityCurve: 0.8,
    tipHardness: 0.5,
  },
  inkSpec: {
    grain: 0.35,
    edgeSoftness: 0.15,
    opacityStability: 0.08,
  },
  physicsProfile: {
    velocitySmoothing: 0.7,
    pressureSmoothing: 0.3,
    directionInertia: 0.6,
  },
  gpuProfile: DEFAULT_GPU_PROFILE,
  ui: {
    previewColor: '#4a4a4a',
    icon: 'pencil',
  },
};

// ============================================================
//  3. Marker（马克笔）
//
//  kernel:    flat pressure (1.0) + high velocity factor
//  ink:       high opacity stability
//  physics:   none (raw input)
// ============================================================

export const MARKER: BrushProduct = {
  id: 'marker',
  name: 'Marker',
  kernelSpec: {
    pressureCurve: 1.0,
    velocityFactor: 6,
    envelopeSize: 8,
    opacityCurve: 1.5,
    tipHardness: 0.1,
  },
  inkSpec: {
    grain: 0.05,
    edgeSoftness: 0.35,
    opacityStability: 0.2,
  },
  physicsProfile: {
    velocitySmoothing: 0.5,
    pressureSmoothing: 0.2,
    directionInertia: 0.5,
  },
  gpuProfile: DEFAULT_GPU_PROFILE,
  ui: {
    previewColor: '#ff6600',
    icon: 'highlighter',
  },
};

// ============================================================
//  4. Watercolor（水彩）
//
//  kernel:    soft pressure curve (0.8)
//  ink:       high edge softness + high grain
//  physics:   mild smoothing only
// ============================================================

export const WATERCOLOR: BrushProduct = {
  id: 'watercolor',
  name: 'Watercolor',
  kernelSpec: {
    pressureCurve: 0.8,
    velocityFactor: 2,
    envelopeSize: 18,
    opacityCurve: 0.6,
    tipHardness: 0.7,
  },
  inkSpec: {
    grain: 0.3,
    edgeSoftness: 0.5,
    opacityStability: 0.05,
  },
  physicsProfile: {
    velocitySmoothing: 0.9,
    pressureSmoothing: 0.5,
    directionInertia: 0.8,
  },
  gpuProfile: DEFAULT_GPU_PROFILE,
  ui: {
    previewColor: '#3388cc',
    icon: 'droplet',
  },
};

// ============================================================
//  Product list — 注册用
// ============================================================

export const STANDARD_PRODUCTS: BrushProduct[] = [PEN, PENCIL, MARKER, WATERCOLOR];
