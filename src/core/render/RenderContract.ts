// ============================================================
//  RenderContract — Renderer 唯一合法输入格式（Phase 5 Final）
//
//  架构收敛：
//  Workspace (mutable source)
//       ↓ createRenderContract()
//  RenderContract (normalized ABI — 唯一跨系统数据结构)
//       ↓
//  Renderer (strict consumer, zero assumptions)
//
//  RenderSnapshot 降级为 createRenderContract() 内部实现细节，
//  不再作为 Renderer 或外部流程可见类型。
//
//  职责：
//  ✔ 统一 stroke 结构（屏蔽历史字段差异）
//  ✔ 统一 camera / bbox / style 访问方式
//  ✔ 消除 Renderer 对"数据来源结构"的任何假设
//  ✔ 为后续 WebGL / GPU / worker 渲染预留 ABI
//
//  强约束：
//  ❌ 不允许 undefined 字段进入 Renderer
//  ❌ 不允许 workspace / engine 类型残留
//  ❌ 不允许 partial stroke
//  ❌ 不允许共享引用（deep clone）
// ============================================================

import type { RenderableStrokeSnapshot, CameraState } from './RenderSnapshot';
import { createRenderSnapshot } from './RenderSnapshot';
import type { IWorkspace } from '../workspace/IWorkspace';

// ============================================================
//  Types — Renderer ABI
// ============================================================

/** 归一化 2D 点 — 只包含渲染必要字段 */
export interface NormalizedPoint {
  x: number;
  y: number;
}

/** 归一化 Stroke — 所有字段有默认值，无 undefined */
export interface NormalizedStroke {
  id: string;
  points: NormalizedPoint[];

  /** 归一化样式（统一单位/默认值） */
  color: string;
  width: number;
  opacity: number;

  /** 预计算包围盒（非空 — 已保证 fallback） */
  bbox: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

/** 归一化相机状态 */
export interface RenderCamera {
  x: number;
  y: number;
  zoom: number;
}

/** Renderer 唯一合法输入 — 一帧完整归一化数据 */
export interface RenderContract {
  frameId: number;
  pageId: string;

  strokes: NormalizedStroke[];
  camera: RenderCamera;

  timestamp: number;
}

// ============================================================
//  Constants
// ============================================================

/** 归一化默认值 — 确保没有任何字段为 undefined */
const DEFAULTS = {
  color: '#000',
  width: 1.5,
  opacity: 1,
  bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
} as const;

// ============================================================
//  Normalizer
// ============================================================

/**
 * 将单个 RenderableStrokeSnapshot 归一化为 NormalizedStroke。
 *
 * 归一化规则：
 * - points: 深拷贝 { x, y }（不共享引用）
 * - color:  s.color ?? "#000"
 * - width:   s.width ?? 1.5
 * - opacity: s.opacity ?? 1 （Schema 预留，当前固定为 1）
 * - bbox:    s.bbox ?? 从 points 计算 ?? zero bbox
 *
 * @returns 完全归一化的 NormalizedStroke，无任何 undefined 字段
 */
function normalizeStroke(snap: RenderableStrokeSnapshot): NormalizedStroke {
  // ❗ 深拷贝 points — 不共享引用
  const points: NormalizedPoint[] = snap.points.map(p => ({ x: p.x, y: p.y }));

  // bbox: 优先用 snapshot 已有 bbox，否则从 points 计算，最后 zero fallback
  let bbox = snap.bbox;
  if (!bbox && points.length > 0) {
    bbox = computeBBoxFromNormalizedPoints(points);
  }
  if (!bbox) {
    bbox = { ...DEFAULTS.bbox };
  }

  return {
    id: snap.id,
    points,
    color: snap.color || DEFAULTS.color,
    width: snap.width ?? DEFAULTS.width,
    opacity: DEFAULTS.opacity,
    bbox: { ...bbox }, // copy — 不共享引用
  };
}

/** 从 NormalizedPoint[] 计算 BBox（纯计算，不做缓存） */
function computeBBoxFromNormalizedPoints(points: NormalizedPoint[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (points.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  if (!isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * [内部] 将 RenderSnapshot 原始数据转换为 RenderContract。
 * RenderSnapshot 在此作为内部中间变量，不对外暴露。
 * 直接接收解构后的字段，消除对 RenderSnapshot 类型的依赖。
 */
function toRenderContract(
  snapStrokes: readonly RenderableStrokeSnapshot[],
  snapCamera: CameraState,
  frameId: number,
  pageId: string,
  timestamp: number,
): RenderContract {
  // 归一化所有 strokes
  const strokes: NormalizedStroke[] = snapStrokes.map(s => normalizeStroke(s));

  // 深拷贝 camera
  const camera: RenderCamera = {
    x: snapCamera.x,
    y: snapCamera.y,
    zoom: snapCamera.zoom,
  };

  return {
    frameId,
    pageId,
    strokes,
    camera,
    timestamp,
  };
}

// ============================================================
//  Phase 5 Final: Direct Builder — Workspace → RenderContract
// ============================================================

/**
 * 从 Workspace 直接构建 RenderContract。
 *
 * RenderSnapshot 降级为内部中间变量，外部流程不可见。
 *
 * 构建流程（一步到位）：
 * Workspace.strokes → createRenderSnapshot (internal) → toRenderContract (internal) → RenderContract
 *
 * @returns 完全归一化的 RenderContract
 */
export function createRenderContract(params: {
  pageId: string;
  workspace: IWorkspace;
  camera: CameraState;
  frameId: number;
}): RenderContract {
  // ⚠️ Snapshot is a transient internal computation structure.
  //    It exists ONLY within this function scope and is never exposed.
  //    RenderContract is the sole cross-module data contract (SSOT).
  const snapshot = createRenderSnapshot(params);
  return toRenderContract(
    snapshot.strokes,
    snapshot.camera,
    snapshot.frameId,
    snapshot.pageId,
    snapshot.timestamp,
  );
}
