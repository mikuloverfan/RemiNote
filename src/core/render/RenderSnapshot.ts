// ============================================================
//  RenderSnapshot — 一帧渲染所需的冻结数据
//  Workspace (mutable source) → RenderSnapshot (immutable) → Renderer
//
//  核心规则：
//  ❌ 不能引用 Workspace Stroke 原对象
//  ❌ 不能共享 points 数组引用
//  ❌ 不能 mutate
//  ✅ deep copy + freeze
//
//  性能要求：
//  snapshot 创建 ≤ O(n strokes)
//  不做 path2D / render / cache build
//  纯数据 copy
// ============================================================

import type { IWorkspace, Stroke } from '../workspace/IWorkspace';

// ============================================================
//  Types
// ============================================================

/** 2D 点 */
interface Point {
  x: number;
  y: number;
}

/** 轴对齐包围盒 */
interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 冻结的相机状态（一帧内不变） */
interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

/** 单笔 stroke 的不可变渲染快照 — 完全解耦自 Workspace Stroke */
interface RenderableStrokeSnapshot {
  readonly id: string;
  readonly points: ReadonlyArray<Point>;
  readonly color: string;
  readonly width: number;
  readonly bbox: BBox | null;
}

/** 一帧渲染所需的完整冻结数据 */
interface RenderSnapshot {
  readonly frameId: number;
  readonly pageId: string;
  readonly strokes: ReadonlyArray<RenderableStrokeSnapshot>;
  readonly camera: CameraState;
  readonly timestamp: number;
}

// ============================================================
//  Pure helpers
// ============================================================

/** 从 points 计算 BBox。O(points.length)，纯计算，不做缓存。 */
function computeBBoxFromPoints(points: ReadonlyArray<Point>): BBox | null {
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

// ============================================================
//  Snapshot Builder
// ============================================================

/**
 * 构建一帧渲染快照。
 *
 * 构建流程：
 * 1️⃣ 从 Workspace 获取 strokes（只读访问）
 * 2️⃣ 逐笔转换为 RenderableStrokeSnapshot（Array.from 深拷贝 points）
 * 3️⃣ Object.freeze 所有数据（snapshot + strokes 数组 + 每个 stroke + points 数组）
 *
 * 复杂度：O(n strokes) — 不做 Path2D / 不做渲染 / 不做缓存构建
 *
 * @returns 完全不可变的 RenderSnapshot
 */
function createRenderSnapshot(params: {
  pageId: string;
  workspace: IWorkspace;
  camera: CameraState;
  frameId: number;
}): RenderSnapshot {
  const { pageId, workspace, camera, frameId } = params;

  // 1️⃣ 获取 strokes（只读访问 Workspace）
  const strokes: Stroke[] = Array.from(workspace.strokes.values());

  // 2️⃣ 转换为 snapshot — 深拷贝 points，计算 bbox
  const snapStrokes: RenderableStrokeSnapshot[] = strokes.map(s => {
    // ❗ Array.from 深拷贝每个 point — 不共享引用
    const points: Point[] = Array.from(s.points, p => ({ x: p.x, y: p.y }));

    const bbox = computeBBoxFromPoints(points);

    // 构建不可变快照对象
    const snap: RenderableStrokeSnapshot = {
      id: s.id,
      points,
      color: s.color,
      width: s.width,
      bbox,
    };

    // 3️⃣ freeze 单个 stroke + 其 points 数组
    Object.freeze(snap);
    Object.freeze(snap.points);

    return snap;
  });

  // freeze strokes 数组本身
  Object.freeze(snapStrokes);

  // 构建最终 snapshot
  const snapshot: RenderSnapshot = {
    frameId,
    pageId,
    strokes: snapStrokes,
    camera: { ...camera }, // copy — 不共享引用
    timestamp: performance.now(),
  };

  // freeze 整个 snapshot + camera
  Object.freeze(snapshot);
  Object.freeze(snapshot.camera);

  return snapshot;
}

// ============================================================
//  Phase 5 Final: RenderSnapshot 降级为内部实现细节
//
//  RenderSnapshot 仅作为 createRenderContract() 内部中间变量，
//  不再作为 Renderer 或外部流程可见类型。
//
//  createRenderSnapshot() 保留导出供 RenderContract.ts 内部使用。
//  snapshotToContract() 已移除 — 迁移至 RenderContract.ts 内部。
// ============================================================

// ============================================================
//  Export
// ============================================================

export type {
  Point,
  BBox,
  CameraState,
  RenderableStrokeSnapshot,
  // ⚠️ RenderSnapshot intentionally NOT exported — internal transient structure only
};

export {
  createRenderSnapshot,
  computeBBoxFromPoints,
};
