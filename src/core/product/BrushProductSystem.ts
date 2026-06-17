// ============================================================
//  Phase 5.9: Brush Product System — 笔刷产品化层
//
//  核心原则：
//  🎯 Brush = configurable product unit（用户可理解对象）
//  🎯 纯数据 — 不包含逻辑、不包含 class、不包含 method
//
//  架构：
//    BrushProduct (pure data)
//        ↓
//    KernelSpec + InkSpec + PhysicsProfile + GPUProfile
//        ↓
//    Render Pipeline (unchanged)
//
//  约束：
//  ❌ 不做 UI system / preset editor / marketplace
//  ❌ 不包含 brush instance methods
//  ❌ 不包含 brush class logic
//  ✅ data structure + runtime mapping only
// ============================================================

import type { BrushKernelSpec } from '../brush/BrushKernelSpec';
import { DEFAULT_SPEC } from '../brush/BrushKernelSpec';

// ============================================================
//  Types
// ============================================================

/** 墨水材质规格 — visual-only 参数 */
export interface InkMaterialSpec {
  /** 颗粒强度 0~1（0=无颗粒，1=最强） */
  grain: number;
  /** 边缘柔化强度 0~1（0=最硬，1=最软） */
  edgeSoftness: number;
  /** 不透明度稳定性 0~1（越大越稳定） */
  opacityStability: number;
}

/** 物理配置 — 输入平滑参数 */
export interface PhysicsProfile {
  /** Velocity EMA 平滑因子 */
  velocitySmoothing: number;
  /** Pressure EMA 平滑因子 */
  pressureSmoothing: number;
  /** 方向惯性权重（prev 占比） */
  directionInertia: number;
}

/** GPU 渲染配置 */
export interface GPUProfile {
  /** 是否启用 instanced rendering */
  instanced: boolean;
  /** 最大 instance 数量 */
  maxInstances: number;
}

/** 笔刷产品 UI 元数据 */
export interface BrushProductUI {
  /** 预览颜色（CSS hex） */
  previewColor: string;
  /** 图标标识 */
  icon: string;
}

/**
 * BrushProduct — 完整笔刷产品定义（纯数据）。
 *
 * 一个 BrushProduct 包含所有运行时需要的配置：
 *   - kernelSpec:  笔刷核心规格（决定形状）
 *   - inkSpec:     墨水材质规格（决定视觉风格）
 *   - physicsProfile: 输入平滑配置
 *   - gpuProfile:   GPU 渲染配置
 *   - ui:          UI 显示元数据
 */
export interface BrushProduct {
  /** 唯一产品 ID */
  id: string;
  /** 用户可见名称 */
  name: string;

  /** 笔刷核心规格 */
  kernelSpec: BrushKernelSpec;
  /** 墨水材质规格 */
  inkSpec: InkMaterialSpec;
  /** 物理配置 */
  physicsProfile: PhysicsProfile;
  /** GPU 渲染配置 */
  gpuProfile: GPUProfile;
  /** UI 元数据 */
  ui: BrushProductUI;
}

// ============================================================
//  Default Specs
// ============================================================

export const DEFAULT_INK_SPEC: InkMaterialSpec = {
  grain: 0.15,
  edgeSoftness: 0.25,
  opacityStability: 0.1,
};

export const DEFAULT_PHYSICS_PROFILE: PhysicsProfile = {
  velocitySmoothing: 0.8,
  pressureSmoothing: 0.35,
  directionInertia: 0.7,
};

export const DEFAULT_GPU_PROFILE: GPUProfile = {
  instanced: true,
  maxInstances: 65536,
};

export const DEFAULT_UI: BrushProductUI = {
  previewColor: '#000000',
  icon: 'pen',
};

// ============================================================
//  Product Registry
// ============================================================

/**
 * BrushProductRegistry — 笔刷产品注册表（纯数据 Map）。
 *
 * 不包含任何逻辑，仅提供 CRUD。
 */
export class BrushProductRegistry {
  private _products = new Map<string, BrushProduct>();

  /** 注册一个笔刷产品 */
  register(product: BrushProduct): void {
    this._products.set(product.id, product);
  }

  /** 获取指定产品 */
  get(id: string): BrushProduct | undefined {
    return this._products.get(id);
  }

  /** 获取所有产品 */
  getAll(): BrushProduct[] {
    return Array.from(this._products.values());
  }

  /** 获取所有产品 ID */
  getIds(): string[] {
    return Array.from(this._products.keys());
  }

  /** 产品数量 */
  get size(): number {
    return this._products.size;
  }
}

/** 全局产品注册表 */
export const brushProductRegistry = new BrushProductRegistry();
