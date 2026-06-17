// ============================================================
//  Shadow Render Layer — ShadowRenderer
//
//  职责：
//  ✔ 在 OffscreenCanvas 中从 FrameSnapshot 重建渲染
//  ✔ 使用 StrokeGeometryEngine + 独立 Path2D cache
//  ✔ 完全隔离 — 不影响主 canvas 任何状态
//  ✔ 随时启停 — enable/disable
//
//  架构：
//    FrameSnapshot → ShadowRenderer.render(snapshot) → OffscreenCanvas
//
//  约束：
//  ❌ 不访问 main.ts CanvasSession / ctx / canvas
//  ❌ 不访问 engine.strokes（只消费 snapshot）
//  ❌ 不创建 DOM 可见元素
//  ❌ 不注册任何 listener
//  ✅ 纯 CPU 渲染 — 不使用 WebGL（保持隔离）
// ============================================================

import {
  buildStrokeGeometry,
  geometryToPath2D,
  drawStampStroke,
  smoothPoints,
  computeWidths,
  type Point2D,
} from '../render/StrokeGeometryEngine';
import { StrokePathCache } from '../render/StrokePathCache';
import type { FrameSnapshot, FrozenStroke, FrozenPoint, FrozenCamera, FrozenBrushParams } from './FrameSnapshot';

// ============================================================
//  Types
// ============================================================

/** Shadow 渲染结果 — 可序列化，供 Diff Engine 消费 */
export interface ShadowRenderOutput {
  /** 对应快照的 frameId */
  frameId: number;
  /** 渲染的 stroke 数量 */
  strokeCount: number;
  /** 渲染的总点数 */
  totalPoints: number;
  /** 每笔 stroke 的 ID 列表（渲染顺序） */
  strokeIds: string[];
  /** 每笔 stroke 的包围盒（世界坐标） */
  strokeBBoxes: Map<string, { minX: number; minY: number; maxX: number; maxY: number }>;
  /** 所有 stroke 的联合包围盒 */
  unionBBox: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /** 渲染耗时 (ms) */
  renderTimeMs: number;
  /** 使用的 camera 状态 */
  camera: FrozenCamera;
  /** 渲染成功的 stroke IDs */
  renderedIds: string[];
  /** 渲染失败的 stroke IDs + 原因 */
  renderErrors: Array<{ strokeId: string; reason: string }>;
}

/** ShadowRenderer 配置 */
export interface ShadowRendererConfig {
  /** offscreen canvas 宽度 (CSS px), 默认不限制 */
  width?: number;
  /** offscreen canvas 高度 (CSS px), 默认不限制 */
  height?: number;
  /** 是否启用 (默认 false) */
  enabled?: boolean;
  /** 是否输出调试日志 */
  debug?: boolean;
}

// ============================================================
//  Constants
// ============================================================

const DEFAULT_CONFIG: Required<ShadowRendererConfig> = {
  width: 0,
  height: 0,
  enabled: false,
  debug: false,
};

// ============================================================
//  ShadowRenderer
// ============================================================

export class ShadowRenderer {
  // ── State ──
  private _canvas: HTMLCanvasElement | null = null;
  private _ctx: CanvasRenderingContext2D | null = null;
  private _pathCache = new StrokePathCache();
  private _enabled = false;
  private _debug = false;
  private _config: Required<ShadowRendererConfig>;

  constructor(config: ShadowRendererConfig = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._enabled = this._config.enabled;
    this._debug = this._config.debug;
  }

  // ==========================================================
  //  Lifecycle
  // ==========================================================

  /** 启用 shadow renderer。创建 offscreen canvas。 */
  enable(): void {
    if (this._enabled) return;

    try {
      this._canvas = document.createElement('canvas');
      // Offscreen: 永远不挂载到 DOM
      this._canvas.style.display = 'none';

      const w = this._config.width || 1024;
      const h = this._config.height || 768;
      this._canvas.width = w;
      this._canvas.height = h;

      this._ctx = this._canvas.getContext('2d');
      if (!this._ctx) {
        throw new Error('Failed to get 2D context for shadow canvas');
      }

      this._enabled = true;
      if (this._debug) {
        console.log('[ShadowRenderer] ✅ enabled — offscreen canvas created', { w, h });
      }
    } catch (err) {
      console.error('[ShadowRenderer] ❌ enable failed:', err);
      this._enabled = false;
      this._canvas = null;
      this._ctx = null;
    }
  }

  /** 禁用 shadow renderer。释放 offscreen canvas。 */
  disable(): void {
    this._enabled = false;
    this._pathCache.clearAll();
    this._canvas = null;
    this._ctx = null;

    if (this._debug) {
      console.log('[ShadowRenderer] ⏹ disabled — resources released');
    }
  }

  get enabled(): boolean {
    return this._enabled;
  }

  // ==========================================================
  //  Render
  // ==========================================================

  /**
   * 从 FrameSnapshot 渲染到 offscreen canvas。
   *
   * 渲染流程（镜像 main.ts renderFrame）：
   * 1. clearRect + 白色背景
   * 2. setTransform(camera)
   * 3. 遍历 strokes → buildPath2D → ctx.stroke()
   *
   * ⚠️ 所有异常在 try/catch 内隔离，不影响调用方。
   *
   * @param snapshot 冻结的帧快照
   * @returns ShadowRenderOutput — 结构化渲染结果
   */
  render(snapshot: FrameSnapshot): ShadowRenderOutput | null {
    if (!this._enabled || !this._ctx || !this._canvas) {
      return null;
    }

    const t0 = performance.now();
    const strokeIds: string[] = [];
    const strokeBBoxes = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
    const renderErrors: Array<{ strokeId: string; reason: string }> = [];
    let totalPoints = 0;

    try {
      const ctx = this._ctx;
      const canvas = this._canvas;

      // ── 确保 canvas 尺寸匹配 ──
      const cam = snapshot.camera;
      const targetW = this._config.width || canvas.width;
      const targetH = this._config.height || canvas.height;
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      // ── 1. Clear + 背景 ──
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // ── 2. 应用 camera transform ──
      //    使用 dpr=1（shadow 不做高分屏适配，保持简单）
      const dpr = 1;
      ctx.setTransform(
        dpr * cam.zoom, 0,
        0, dpr * cam.zoom,
        cam.x * dpr,
        cam.y * dpr,
      );

      // ── 3. 构建渲染 stroke 列表（committed + preview） ──
      const allStrokes: FrozenStroke[] = [...snapshot.strokes];
      if (snapshot.previewStroke && snapshot.previewStroke.points.length >= 2) {
        allStrokes.push(snapshot.previewStroke);
      }

      // ── 4. 逐 stroke 渲染 ──
      const brushParams = snapshot.brushParams;
      let unionMinX = Infinity, unionMinY = Infinity;
      let unionMaxX = -Infinity, unionMaxY = -Infinity;

      for (const s of allStrokes) {
        try {
          if (!s.points || s.points.length < 2) {
            totalPoints += s.points?.length ?? 0;
            continue;
          }

          totalPoints += s.points.length;

          // 计算包围盒
          const bbox = this._computeStrokeBBox(s.points);
          if (bbox) {
            strokeBBoxes.set(s.id, bbox);
            unionMinX = Math.min(unionMinX, bbox.minX);
            unionMinY = Math.min(unionMinY, bbox.minY);
            unionMaxX = Math.max(unionMaxX, bbox.maxX);
            unionMaxY = Math.max(unionMaxY, bbox.maxY);
          }

          // ⭐ Stamp rendering (PS-style overlapping circles)
          // Replaces old mesh Path2D + ctx.stroke() approach
          this._drawStampStroke(ctx, s, brushParams);

          strokeIds.push(s.id);
        } catch (strokeErr) {
          renderErrors.push({
            strokeId: s.id,
            reason: strokeErr instanceof Error ? strokeErr.message : 'unknown',
          });
        }
      }

      const t1 = performance.now();

      return {
        frameId: snapshot.frameId,
        strokeCount: allStrokes.length,
        totalPoints,
        strokeIds,
        strokeBBoxes,
        unionBBox: isFinite(unionMinX)
          ? { minX: unionMinX, minY: unionMinY, maxX: unionMaxX, maxY: unionMaxY }
          : null,
        renderTimeMs: t1 - t0,
        camera: snapshot.camera,
        renderedIds: strokeIds,
        renderErrors,
      };
    } catch (err) {
      // 🔒 崩溃隔离：Shadow renderer 的任何异常不影响调用方
      console.error('[ShadowRenderer] ❌ render() crashed:', err);

      return {
        frameId: snapshot.frameId,
        strokeCount: 0,
        totalPoints: 0,
        strokeIds: [],
        strokeBBoxes: new Map(),
        unionBBox: null,
        renderTimeMs: performance.now() - t0,
        camera: snapshot.camera,
        renderedIds: [],
        renderErrors: [{
          strokeId: '__shadow__',
          reason: err instanceof Error ? err.message : 'fatal render crash',
        }],
      };
    }
  }

  // ==========================================================
  //  Query
  // ==========================================================

  /** 获取 offscreen canvas（只读，用于 toDataURL / 对比）。 */
  getCanvas(): HTMLCanvasElement | null {
    return this._canvas;
  }

  /** 获取 offscreen canvas 的 base64 data URL。 */
  toDataURL(type?: string, quality?: number): string | null {
    if (!this._canvas) return null;
    try {
      return this._canvas.toDataURL(type ?? 'image/png', quality);
    } catch {
      return null;
    }
  }

  /** 清空 Path2D 缓存。 */
  invalidateCache(): void {
    this._pathCache.clearAll();
  }

  // ==========================================================
  //  ⭐ Stamp-based stroke rendering (PS-style)
  //  Replaces old mesh Path2D approach.
  // ==========================================================

  private _drawStampStroke(
    ctx: CanvasRenderingContext2D,
    s: FrozenStroke,
    p: FrozenBrushParams,
  ): void {
    try {
      const baseW = s._penParams?.strokeWidth ?? p.strokeWidth;
      const smoothing = s._penParams?.smoothness ?? p.smoothness;
      const minW = Math.max(0.3, baseW * 0.08);
      const maxW = Math.min(baseW * 2.0, 8);

      // Build Point2D array from frozen points
      const points: Point2D[] = (s.points as readonly FrozenPoint[]).map((pt, i, arr) => ({
        x: pt.x,
        y: pt.y,
        pressure: 0.5,
        speed: i > 0
          ? Math.min(1, Math.hypot(pt.x - arr[i - 1].x, pt.y - arr[i - 1].y) / 20)
          : 0,
      }));

      // Smooth + compute widths
      const smoothed = smoothPoints(points, smoothing);
      const widths = computeWidths(smoothed, baseW, 0.25, minW / baseW, maxW / baseW);

      // ⭐ Draw as overlapping stamps (texture-based, PS-style)
      drawStampStroke(ctx, {
        points: smoothed,
        widths,
        color: s.color,
        stampSpacing: 1.0,
        tipType: 'soft-round',
        jitter: 0.4,
      });
    } catch {
      // Silently skip on error (shadow renderer is non-critical)
    }
  }

  // ==========================================================
  //  Private: BBox computation
  // ==========================================================

  private _computeStrokeBBox(
    pts: readonly FrozenPoint[],
  ): { minX: number; minY: number; maxX: number; maxY: number } | null {
    if (!pts || pts.length === 0) return null;

    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    if (!isFinite(minX)) return null;
    return { minX, minY, maxX, maxY };
  }
}

export default ShadowRenderer;
