// ============================================================
//  RenderDiff — Stroke 级增量变更索引
//  把 Renderer 从"一帧一坨数据"升级为"可追踪 stroke 级变更"
//
//  核心概念：
//  - StrokeDiff: 当前帧相对上一帧的 stroke 变更集合
//  - RenderDiffState: 一帧的完整 diff 快照
//  - computeStrokeDiff: 纯函数，对比两个 RenderContract 计算差异
//
//  约束：
//  ❌ 不允许 diff 影响 workspace
//  ❌ 不允许 DOM 操作
//  ❌ 不允许 engine 参与 diff
//  ✅ 纯数据对比，零副作用
// ============================================================

import type { RenderContract } from './RenderContract';

// ============================================================
//  Types
// ============================================================

/** Stroke 级增量变更索引 */
export interface StrokeDiff {
  /** 本帧新增的 stroke ID 列表 */
  added: string[];
  /** 本帧更新的 stroke ID 列表（存在于上一帧且本帧） */
  updated: string[];
  /** 本帧删除的 stroke ID 列表（存在于上一帧但不在本帧） */
  removed: string[];
}

/** 一帧的完整 diff 快照 */
export interface RenderDiffState {
  frameId: number;
  previousHash: string | null;
  currentHash: string;
  strokeDiff: StrokeDiff;
}

// ============================================================
//  Diff Calculator
// ============================================================

/**
 * 对比两个 RenderContract，计算 stroke 级增量差异。
 *
 * 算法：
 * 1. 如果 prev 为 null（首帧），所有 next.strokes 标记为 added
 * 2. 构建 prev/next stroke ID → stroke 映射
 * 3. 遍历 next keys：如果在 prev 中不存在 → added；否则 → updated
 * 4. 遍历 prev keys：如果不在 next 中 → removed
 *
 * 复杂度：O(n + m) where n = prev.strokes.length, m = next.strokes.length
 *
 * @param prev 上一帧的 RenderContract（null 表示首帧）
 * @param next 当前帧的 RenderContract
 * @returns StrokeDiff — 纯数据，不修改任何状态
 */
export function computeStrokeDiff(
  prev: RenderContract | null,
  next: RenderContract,
): StrokeDiff {
  // 首帧 — 所有 stroke 都是新增
  if (!prev) {
    return {
      added: next.strokes.map(s => s.id),
      updated: [],
      removed: [],
    };
  }

  const prevMap = new Map(prev.strokes.map(s => [s.id, s]));
  const nextMap = new Map(next.strokes.map(s => [s.id, s]));

  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  // 检查新增和更新
  for (const id of nextMap.keys()) {
    if (!prevMap.has(id)) {
      added.push(id);
    } else {
      updated.push(id);
    }
  }

  // 检查删除
  for (const id of prevMap.keys()) {
    if (!nextMap.has(id)) {
      removed.push(id);
    }
  }

  return { added, updated, removed };
}
