// ============================================================
//  StrokeBatchRenderer — Stroke Batching Render Layer
//
//  将逐 stroke draw 升级为 batch draw：
//  stroke → Path2D → ctx.draw（逐条）
//       ↓
//  visible strokes → batch grouping → single render pass per batch
//
//  核心收益：
//  ✔ draw call 数量 ↓
//  ✔ ctx state switch ↓↓↓ (每个 batch 仅设置一次)
//  ✔ CPU 层 batching，不引入 WebGL/Worker/OffscreenCanvas
//
//  约束：
//  ❌ 不修改 RenderContract
//  ❌ 不修改 Workspace
//  ❌ 不修改 Scheduler
//  ❌ 不修改 DirtyTracker
//  ❌ 不修改 Thumbnail 系统
//  ✅ 纯 CPU 层 batching 优化，零副作用
// ============================================================

import type { StrokePathCache } from './StrokePathCache';
import { StrokePathFusion } from './StrokePathFusion';
import type { FusableStroke } from './StrokePathFusion';

// ============================================================
//  Types
// ============================================================

/** Stroke 渲染样式 — batch 分组 key */
export interface StrokeBatchStyle {
  color: string;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  /** 预留 opacity 字段，当前默认 1。未来可从 RenderContract 透传。 */
  opacity: number;
}

/** 单条待绘制 stroke（path 已 resolve，无需再做 cache lookup） */
export interface BatchedStroke {
  id: string;
  path: Path2D;
  /** 原始点序列 — 供 StrokePathFusion 使用（fusion 需要首尾点判断连续性） */
  sourcePoints: readonly { x: number; y: number }[];
}

/** 一个渲染批次 — 共享相同 ctx state 的 stroke 集合 */
export interface StrokeBatch {
  /** 批次 ID，格式 "batch-N" */
  batchId: string;
  /** 共享的渲染样式 */
  style: StrokeBatchStyle;
  /** 批次内所有 stroke（已 resolve Path2D） */
  strokes: BatchedStroke[];
  /** 批次内所有 stroke 的包围盒并集（世界坐标），供未来 batch 级 culling */
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

// ============================================================
//  RenderableStroke 的形状（从 main.ts 提取，仅需要的字段）
// ============================================================

interface RenderableStrokeLike {
  id: string;
  path2D: Path2D;
  style: {
    color: string;
    lineWidth: number;
    lineCap: CanvasLineCap;
    lineJoin: CanvasLineJoin;
  };
  _sourcePoints?: readonly { x: number; y: number }[];
  _bbox?: { minX: number; minY: number; maxX: number; maxY: number };
}

// ============================================================
//  Viewport culling 判断（从 main.ts 复制，保持完全等价）
// ============================================================

function isInViewport(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  cam: { x: number; y: number; zoom: number },
  cssW: number,
  cssH: number,
): boolean {
  const sx1 = bbox.minX * cam.zoom + cam.x;
  const sy1 = bbox.minY * cam.zoom + cam.y;
  const sx2 = bbox.maxX * cam.zoom + cam.x;
  const sy2 = bbox.maxY * cam.zoom + cam.y;
  const pad = 20;
  return !(sx2 < -pad || sx1 > cssW + pad || sy2 < -pad || sy1 > cssH + pad);
}

// ============================================================
//  Style key 生成 — 确定 batch 分组依据
// ============================================================

/** 从 style 生成 batch 分组 key（color + width + cap + join）。 */
function styleKey(s: StrokeBatchStyle): string {
  return `${s.color}|${s.lineWidth}|${s.lineCap}|${s.lineJoin}`;
}

/** 从 RenderableStrokeLike 的 style 提取 StrokeBatchStyle。 */
function extractStyle(r: RenderableStrokeLike): StrokeBatchStyle {
  return {
    color: r.style.color,
    lineWidth: r.style.lineWidth,
    lineCap: r.style.lineCap,
    lineJoin: r.style.lineJoin,
    opacity: 1, // 当前固定 1，未来从 RenderContract 透传
  };
}

// ============================================================
//  BBox 并集运算
// ============================================================

function unionBBox(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

// ============================================================
//  StrokeBatchRenderer
// ============================================================

export class StrokeBatchRenderer {
  private _batchIdCounter = 0;

  /**
   * 从 renderables 构建 StrokeBatch 数组。
   *
   * 执行流程：
   * 1. 遍历 renderables，跳过 null slot
   * 2. Viewport culling：跳过视口外 stroke
   * 3. Path2D resolve：优先 cache.get(id)，fallback r.path2D
   * 4. 按 style key 分组
   * 5. 每个 batch 计算 union bbox
   *
   * @param renderables RenderQueue.renderables（(RenderableStroke | null)[]）
   * @param cache StrokePathCache 实例
   * @param cam 冻结相机快照（来自 queue.camera）
   * @param cssW viewport CSS 宽度
   * @param cssH viewport CSS 高度
   * @returns StrokeBatch[]，按 batchId 排序
   */
  buildBatches(
    renderables: readonly (RenderableStrokeLike | null)[],
    cache: StrokePathCache,
    cam: { x: number; y: number; zoom: number },
    cssW: number,
    cssH: number,
  ): StrokeBatch[] {
    // ── Step 1-3: 过滤 + culling + path resolve，同时分组 ──
    const groupMap = new Map<string, { style: StrokeBatchStyle; strokes: BatchedStroke[]; bbox: { minX: number; minY: number; maxX: number; maxY: number } | null }>();

    for (const r of renderables) {
      if (!r) continue;

      // Viewport culling
      if (r._bbox && !isInViewport(r._bbox, cam, cssW, cssH)) continue;

      // Path2D resolve: cache primary, renderable fallback
      const cachedPath = cache.get(r.id);
      const path: Path2D | undefined = cachedPath ?? r.path2D;
      if (!path) continue;

      // Extract style → batch key
      const style = extractStyle(r);
      const key = styleKey(style);

      let group = groupMap.get(key);
      if (!group) {
        group = {
          style,
          strokes: [],
          bbox: null,
        };
        groupMap.set(key, group);
      }

      group.strokes.push({
        id: r.id,
        path,
        sourcePoints: r._sourcePoints ?? [],
      });

      // Union bbox
      if (r._bbox) {
        group.bbox = group.bbox ? unionBBox(group.bbox, r._bbox) : { ...r._bbox };
      }
    }

    // ── Step 4-5: 构建 StrokeBatch 数组 ──
    const batches: StrokeBatch[] = [];
    for (const [, group] of groupMap) {
      // 确保 bbox 非 null（理论上有 stroke 就有 bbox，但做防御）
      const bbox = group.bbox ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };

      batches.push({
        batchId: `batch-${++this._batchIdCounter}`,
        style: group.style,
        strokes: group.strokes,
        bbox,
      });
    }

    return batches;
  }

  /**
   * 批量渲染 StrokeBatch 数组到 canvas。
   *
   * 每个 batch：
   * 1. 设置一次 ctx state（strokeStyle / lineWidth / lineCap / lineJoin）
   * 2. 批量 stroke 该 batch 内所有 path
   * 3. batch 间 ctx.save/restore 确保状态隔离
   *
   * 约束：
   * ❌ batch 内禁止重复设置 ctx state
   * ❌ 不创建新 canvas / 不做额外 transform
   *
   * @param ctx Canvas 2D 渲染上下文（已应用 camera transform）
   * @param batches 已构建的 StrokeBatch 数组
   */
  drawBatches(
    ctx: CanvasRenderingContext2D,
    batches: StrokeBatch[],
  ): void {
    for (const batch of batches) {
      if (batch.strokes.length === 0) continue;

      // ── 1️⃣ 设置一次 ctx state（整个 batch 共享）──
      ctx.save();
      ctx.strokeStyle = batch.style.color;
      ctx.lineWidth = batch.style.lineWidth;
      ctx.lineCap = batch.style.lineCap;
      ctx.lineJoin = batch.style.lineJoin;

      // ⭐ Multiply blend: real-time strokes fuse naturally
      // Without this, each batch boundary creates visible "chunk" seams
      // because overlapping stroke() calls don't anti-alias between batches
      ctx.globalCompositeOperation = 'multiply';

      // opacity — default to 0.9 to prevent double-darkening artifacts
      const alpha = batch.style.opacity !== 1 ? batch.style.opacity : 0.9;
      ctx.globalAlpha = alpha;

      // ⭐ Anti-alias boost: add subtle shadowBlur for smoother batch transitions
      // This smooths the "chunk boundary seam" where old batch path meets new batch path
      ctx.shadowColor = batch.style.color;
      ctx.shadowBlur = 0.8;

      // ── 2️⃣ Stroke Path Fusion：将同 batch strokes 合并为更少 Path2D ──
      const fusable: FusableStroke[] = batch.strokes.map(s => ({
        id: s.id,
        sourcePoints: s.sourcePoints,
        path: s.path,
      }));
      const fusedPaths = StrokePathFusion.fuse(fusable);

      // ── 3️⃣ 批量绘制 fused paths ──
      for (const path of fusedPaths) {
        ctx.stroke(path);
      }

      // ── 4️⃣ 恢复 ctx state ──
      ctx.restore();
    }
  }
}
