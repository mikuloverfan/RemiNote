// ============================================================
//  OffscreenThumbnailRenderer — 离线缩略图渲染器
//  从 Workspace + Stroke 数据生成 page thumbnail
//
//  核心职责：
//  ✔ 纯消费层 — 只读 Workspace，不修改任何现有模块
//  ✔ 使用 offscreen <canvas> 独立渲染，不影响主 canvas
//  ✔ 异步接口（Promise），batch-friendly
//  ✔ 自动写入 ThumbnailCache
//  ✔ 复用 StrokePathCache 加速 Path2D 构建
//
//  约束：
//  ❌ 不调用 renderFrame / RenderScheduler
//  ❌ 不修改 Workspace / Renderer / Engine
//  ❌ 不影响主 canvas DOM
//
//  调用约定（Phase 3 集成时）：
//  1. 调用方确保 Workspace 已加载目标 page 的 strokes
//  2. renderer.renderPage(pageId) 读取 workspace.strokes
//  3. 生成缩略图 → 写入 thumbnailCache
// ============================================================

import type { Stroke, IWorkspace } from '../workspace/IWorkspace';
import { StrokePathCache } from '../render/StrokePathCache';
import { thumbnailCache, type PageThumbnail } from './ThumbnailCache';

// ============================================================
//  常量
// ============================================================

const THUMB_DEFAULTS = {
  /** 缩略图宽度（CSS pixels） */
  width: 300,
  /** 最大高度（超出则等比缩放） */
  maxHeight: 400,
  /** 最小高度 */
  minHeight: 100,
  /** 内容内边距 */
  padding: 12,
  /** 空白页默认高度 */
  emptyHeight: 200,
} as const;

/** batch 渲染每帧处理上限 */
const BATCH_CHUNK_SIZE = 10;

// ============================================================
//  buildThumbnailPath — 独立 Path2D 构建（不依赖 main.ts）
//  逻辑完全等价于 main.ts buildPath2D，但自包含
// ============================================================

function buildThumbnailPath(
  points: Array<{ x: number; y: number }>,
  cornerKeep: number = 0.3,
  smoothness: number = 0.5,
): Path2D {
  const path = new Path2D();

  if (points.length === 0) return path;

  if (points.length === 1) {
    path.moveTo(points[0].x, points[0].y);
    path.arc(points[0].x, points[0].y, 1, 0, Math.PI * 2);
    return path;
  }

  if (points.length === 2) {
    path.moveTo(points[0].x, points[0].y);
    path.lineTo(points[1].x, points[1].y);
    return path;
  }

  const thresholdAngle = cornerKeep * Math.PI;
  path.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length - 1; i++) {
    const v1x = points[i].x - points[i - 1].x;
    const v1y = points[i].y - points[i - 1].y;
    const v2x = points[i + 1].x - points[i].x;
    const v2y = points[i + 1].y - points[i].y;
    const dot = v1x * v2x + v1y * v2y;
    const m1 = Math.hypot(v1x, v1y);
    const m2 = Math.hypot(v2x, v2y);
    const cosA = m1 && m2 ? dot / (m1 * m2) : 1;
    const angle = Math.acos(Math.max(-1, Math.min(1, cosA)));

    if (angle > thresholdAngle) {
      path.lineTo(points[i].x, points[i].y);
      continue;
    }

    const t = smoothness;
    path.quadraticCurveTo(
      points[i].x,
      points[i].y,
      points[i].x + (points[i + 1].x - points[i].x) * t,
      points[i].y + (points[i + 1].y - points[i].y) * t,
    );
  }

  path.lineTo(points[points.length - 1].x, points[points.length - 1].y);
  return path;
}

// ============================================================
//  BBox 计算工具
// ============================================================

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function computeStrokesBBox(strokes: Stroke[]): BBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const s of strokes) {
    if (!s?.points) continue;
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  if (!isFinite(minX)) return null;

  return { minX, minY, maxX, maxY };
}

// ============================================================
//  OffscreenThumbnailRenderer
// ============================================================

class OffscreenThumbnailRenderer {
  private _workspace: IWorkspace | null = null;
  private _strokePathCache = new StrokePathCache();

  // ==========================================================
  //  Configuration
  // ==========================================================

  /** 绑定 Workspace 引用（只读消费）。 */
  setWorkspace(ws: IWorkspace): void {
    this._workspace = ws;
  }

  /** 当前绑定的 Workspace，用于调试。 */
  get workspace(): IWorkspace | null {
    return this._workspace;
  }

  // ==========================================================
  //  Public API
  // ==========================================================

  /**
   * 为单个 page 生成缩略图。
   *
   * 前提：调用方已确保 Workspace 中加载了目标 page 的 strokes。
   * 内部流程：
   *   1. 读取 workspace.strokes（唯一真数据源）
   *   2. 计算 strokes 联合 BBox
   *   3. 创建 offscreen canvas（width=300px，height 按比例）
   *   4. 应用仿射变换（fit + center + padding）
   *   5. 渲染所有 strokes（优先 StrokePathCache，fallback buildPath2D）
   *   6. 输出 PageThumbnail → 写入 thumbnailCache
   *
   * @returns PageThumbnail（dirty = false）
   */
  async renderPage(pageId: string): Promise<PageThumbnail> {
    // ① 从 Workspace 读取 strokes（唯一真数据源）
    const strokes = this._workspace
      ? Array.from(this._workspace.strokes.values())
      : [];

    return this._renderStrokesToThumbnail(pageId, strokes);
  }

  /**
   * 批量生成缩略图，每帧最多处理 BATCH_CHUNK_SIZE 页。
   *
   * 前提：调用方需在每批之前确保 Workspace 已加载对应 page 的 strokes。
   * 实际场景中由外部循环配合 Notebook 数据源完成。
   *
   * @param pageIds 待渲染 page ID 列表
   */
  async renderBatch(pageIds: string[]): Promise<void> {
    for (let i = 0; i < pageIds.length; i += BATCH_CHUNK_SIZE) {
      const chunk = pageIds.slice(i, i + BATCH_CHUNK_SIZE);
      for (const pageId of chunk) {
        await this.renderPage(pageId);
      }

      // 分帧：让出主线程给 UI / 主渲染
      if (i + BATCH_CHUNK_SIZE < pageIds.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  // ==========================================================
  //  Internal: core render logic (sync)
  // ==========================================================

  /**
   * 核心渲染——纯同步 canvas 操作，被 renderPage 调用。
   * 分离 sync/async 边界：async 仅为 batch-friendly 契约。
   */
  private _renderStrokesToThumbnail(
    pageId: string,
    strokes: Stroke[],
  ): PageThumbnail {
    // ② 计算 BBox
    const bbox = computeStrokesBBox(strokes);

    // ③ 确定 canvas 尺寸
    let canvasW = THUMB_DEFAULTS.width;
    let canvasH: number;

    if (!bbox) {
      // 空白页：使用默认高度
      canvasH = THUMB_DEFAULTS.emptyHeight;
    } else {
      const contentW = bbox.maxX - bbox.minX || 1;
      const contentH = bbox.maxY - bbox.minY || 1;
      const aspect = contentH / contentW;
      canvasH = Math.round(canvasW * aspect);
      canvasH = Math.max(THUMB_DEFAULTS.minHeight, Math.min(THUMB_DEFAULTS.maxHeight, canvasH));
    }

    // ④ 创建 offscreen canvas（脱离 DOM，不影响主 canvas）
    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d')!;

    // 填充白色背景
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // ⑧ 空白页：直接返回
    if (!bbox || strokes.length === 0) {
      const thumb: PageThumbnail = {
        pageId,
        image: canvas.toDataURL('image/png'),
        width: canvasW,
        height: canvasH,
        updatedAt: Date.now(),
        dirty: false,
      };
      thumbnailCache.set(pageId, thumb);
      return thumb;
    }

    // ⑤ 计算仿射变换：fit content into canvas（保持比例 + 居中）
    const contentW = bbox.maxX - bbox.minX || 1;
    const contentH = bbox.maxY - bbox.minY || 1;
    const pad = THUMB_DEFAULTS.padding;
    const availW = canvasW - pad * 2;
    const availH = canvasH - pad * 2;
    const scale = Math.min(availW / contentW, availH / contentH);
    const offsetX = pad + (availW - contentW * scale) / 2 - bbox.minX * scale;
    const offsetY = pad + (availH - contentH * scale) / 2 - bbox.minY * scale;

    // ⑥ 应用变换
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // ⑦ 渲染 strokes
    for (const s of strokes) {
      if (!s?.points || s.points.length < 2) continue;

      // 优先 StrokePathCache，fallback buildPath2D
      let path = this._strokePathCache.get(s.id);
      if (!path) {
        const penParams = s._penParams;
        path = buildThumbnailPath(
          s.points,
          penParams?.cornerKeep ?? 0.3,
          penParams?.smoothness ?? 0.5,
        );
        this._strokePathCache.set(s.id, path);
      }

      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.stroke(path);
    }

    ctx.restore();

    // ⑧ 输出
    const thumb: PageThumbnail = {
      pageId,
      image: canvas.toDataURL('image/png'),
      width: canvasW,
      height: canvasH,
      updatedAt: Date.now(),
      dirty: false,
    };

    // 自动写入缓存
    thumbnailCache.set(pageId, thumb);

    return thumb;
  }

  // ==========================================================
  //  Lifecycle
  // ==========================================================

  /** 清空内部 Path2D 缓存（page switch / destroy 时调用）。 */
  invalidateCache(): void {
    this._strokePathCache.invalidateAll();
  }

  /** 解绑 Workspace + 清空缓存。 */
  destroy(): void {
    this._workspace = null;
    this._strokePathCache.invalidateAll();
  }
}

// ============================================================
//  Export — 全局单例
// ============================================================

export const offscreenThumbnailRenderer = new OffscreenThumbnailRenderer();
export { OffscreenThumbnailRenderer };
