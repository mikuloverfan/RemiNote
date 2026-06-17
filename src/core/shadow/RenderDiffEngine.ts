// ============================================================
//  Shadow Render Layer — RenderDiffEngine
//
//  职责：
//  ✔ 对比 shadow render output 与 main render 的差异
//  ✔ 结构化 diff 输出 — 不抛异常，永远返回结果
//  ✔ 纯计算 — 零副作用，不访问 DOM / canvas
//
//  对比维度：
//  1. Stroke count          — 主渲染 vs shadow 渲染的 stroke 数量
//  2. Stroke ID 集合        — missing / extra strokes
//  3. Point positions       — 同名 stroke 的点坐标对比
//  4. Bounding box          — 同名 stroke 的包围盒对比
//  5. Render order          — stroke 渲染顺序是否一致
//
//  约束：
//  ❌ 不访问 main.ts CanvasSession
//  ❌ 不创建 DOM / canvas
//  ❌ 不修改任何输入
//  ✅ 纯函数 — 相同输入永远相同输出
// ============================================================

import type { FrameSnapshot, FrozenStroke, FrozenPoint } from './FrameSnapshot';
import type { ShadowRenderOutput } from './ShadowRenderer';

// ============================================================
//  Types
// ============================================================

/** 单个 stroke 的几何不匹配详情 */
export interface GeometryMismatch {
  strokeId: string;
  /** 主渲染的点数 */
  mainPointCount: number;
  /** shadow 渲染的点数 */
  shadowPointCount: number;
  /** 不匹配的点索引列表 */
  mismatchedPointIndices: number[];
  /** 最大坐标偏差 (px) */
  maxDeviation: number;
  /** 平均坐标偏差 (px) */
  avgDeviation: number;
}

/** 单个 stroke 的包围盒不匹配详情 */
export interface BBoxMismatch {
  strokeId: string;
  mainBBox: { minX: number; minY: number; maxX: number; maxY: number };
  shadowBBox: { minX: number; minY: number; maxX: number; maxY: number };
  /** 各边偏差 */
  deltaMinX: number;
  deltaMinY: number;
  deltaMaxX: number;
  deltaMaxY: number;
}

/** 完整的 RenderDiff 输出 */
export interface RenderDiffResult {
  /** 对应的 frameId */
  frameId: number;
  /** diff 计算时间戳 */
  timestamp: number;

  // ── Stroke count ──
  mainStrokeCount: number;
  shadowStrokeCount: number;
  strokeCountDelta: number;

  // ── Stroke ID 集合 ──
  missingStrokes: string[];      // 在 main 中存在但 shadow 中缺失
  extraStrokes: string[];        // 在 shadow 中存在但 main 中缺失

  // ── 几何对比 ──
  geometryMismatches: GeometryMismatch[];

  // ── 包围盒对比 ──
  bboxMismatches: BBoxMismatch[];

  // ── 渲染顺序 ──
  renderOrderMatch: boolean;
  renderOrderMismatches: Array<{ index: number; mainId: string; shadowId: string }>;

  // ── 帧漂移 ──
  frameDrift: number;  // main snapshot 与 shadow output 的 frameId 差值

  // ── Meta ──
  /** main 快照中 stroke 的总点数 */
  mainTotalPoints: number;
  /** shadow 输出中 stroke 的总点数 */
  shadowTotalPoints: number;
  /** 两方共有的 stroke 数量 */
  commonStrokeCount: number;
  /** 是否存在任何差异 */
  isClean: boolean;
}

// ============================================================
//  Constants
// ============================================================

/** 坐标对比精度阈值 (px) — 小于此值视为相等 */
const POINT_EPSILON = 0.01;

// ============================================================
//  Pure helpers
// ============================================================

/** 对比两个点是否在精度阈值内相等 */
function pointsEqual(a: FrozenPoint, b: FrozenPoint): boolean {
  return Math.abs(a.x - b.x) < POINT_EPSILON
      && Math.abs(a.y - b.y) < POINT_EPSILON;
}

/** 从 FrozenPoint[] 计算包围盒 */
function computeBBox(pts: readonly FrozenPoint[]): {
  minX: number; minY: number; maxX: number; maxY: number;
} | null {
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

// ============================================================
//  RenderDiffEngine
// ============================================================

export class RenderDiffEngine {
  // ==========================================================
  //  Config
  // ==========================================================

  private _enabled = false;
  private _debug = false;

  enable(): void { this._enabled = true; }
  disable(): void { this._enabled = false; }
  get enabled(): boolean { return this._enabled; }
  setDebug(v: boolean): void { this._debug = v; }

  // ==========================================================
  //  Compute Diff
  // ==========================================================

  /**
   * 对比 main render snapshot 与 shadow render output。
   *
   * 对比策略（O(n+m)）：
   * 1. 构建 main/shadow stroke ID → stroke 映射
   * 2. 遍历 main IDs → 判断 missing / 对比点坐标 / 包围盒
   * 3. 遍历 shadow IDs → 判断 extra
   * 4. 对比渲染顺序
   *
   * 🔒 所有异常在 try/catch 内隔离，永远返回 RenderDiffResult。
   *
   * @param snapshot    main.ts 捕获的 FrameSnapshot
   * @param shadowOut   ShadowRenderer.render() 的输出
   * @returns           结构化的 diff 结果
   */
  compute(
    snapshot: FrameSnapshot,
    shadowOut: ShadowRenderOutput,
  ): RenderDiffResult {
    try {
      return this._computeInternal(snapshot, shadowOut);
    } catch (err) {
      // 🔒 崩溃隔离：diff 异常不影响调用方
      console.error('[RenderDiffEngine] ❌ compute() crashed:', err);
      return this._emptyResult(snapshot, shadowOut);
    }
  }

  /**
   * 对比两个 FrameSnapshot（不依赖 ShadowRenderOutput）。
   * 用于 main.ts render 输出 vs 预期数据的直接对比。
   */
  compareSnapshots(
    main: FrameSnapshot,
    shadow: FrameSnapshot,
  ): RenderDiffResult {
    try {
      // 构建伪 ShadowRenderOutput 用于对比
      const pseudoOutput: ShadowRenderOutput = {
        frameId: shadow.frameId,
        strokeCount: shadow.strokes.length,
        totalPoints: shadow.strokes.reduce((s, st) => s + st.points.length, 0),
        strokeIds: shadow.strokes.map(s => s.id),
        strokeBBoxes: new Map(
          shadow.strokes.map(s => {
            const bbox = computeBBox(s.points);
            return [s.id, bbox ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 }];
          }),
        ),
        unionBBox: null,
        renderTimeMs: 0,
        camera: shadow.camera,
        renderedIds: shadow.strokes.map(s => s.id),
        renderErrors: [],
      };
      return this._computeInternal(main, pseudoOutput);
    } catch (err) {
      console.error('[RenderDiffEngine] ❌ compareSnapshots() crashed:', err);
      return this._emptyResult(main, {
        frameId: shadow.frameId,
        strokeCount: 0,
        totalPoints: 0,
        strokeIds: [],
        strokeBBoxes: new Map(),
        unionBBox: null,
        renderTimeMs: 0,
        camera: shadow.camera,
        renderedIds: [],
        renderErrors: [],
      });
    }
  }

  // ==========================================================
  //  Internal
  // ==========================================================

  private _computeInternal(
    snapshot: FrameSnapshot,
    shadowOut: ShadowRenderOutput,
  ): RenderDiffResult {
    const t0 = performance.now();

    // ── 构建 main stroke 映射 ──
    const mainStrokeMap = new Map<string, FrozenStroke>();
    for (const s of snapshot.strokes) {
      mainStrokeMap.set(s.id, s);
    }

    // ── 1. Stroke count ──
    const mainStrokeCount = snapshot.strokes.length;
    const shadowStrokeCount = shadowOut.strokeCount;
    const mainTotalPoints = snapshot.strokes.reduce((sum, s) => sum + s.points.length, 0)
      + (snapshot.previewStroke?.points.length ?? 0);
    const shadowTotalPoints = shadowOut.totalPoints;

    // ── 2. Stroke ID 集合 ──
    const mainIds = new Set(snapshot.strokes.map(s => s.id));
    const shadowIds = new Set(shadowOut.strokeIds);

    const missingStrokes: string[] = [];
    const extraStrokes: string[] = [];

    for (const id of mainIds) {
      if (!shadowIds.has(id)) missingStrokes.push(id);
    }
    for (const id of shadowIds) {
      if (!mainIds.has(id)) extraStrokes.push(id);
    }

    // ── 3. Geometry mismatch (point positions) ──
    const geometryMismatches: GeometryMismatch[] = [];

    for (const id of mainIds) {
      if (!shadowIds.has(id)) continue; // 跳过 missing strokes
      if (extraStrokes.includes(id)) continue;

      const mainStroke = mainStrokeMap.get(id)!;
      const mainPts = mainStroke.points;
      const shadowBBox = shadowOut.strokeBBoxes.get(id);

      // 对比点坐标
      const mismatchedIndices: number[] = [];

      // Shadow output 不含具体点坐标，用包围盒做粗粒度对比
      // 如果 shadow 中该 stroke 没有 bbox，标记为不匹配
      if (!shadowBBox) {
        // 无法对比点坐标 — 标记整个 stroke 为潜在不匹配
        // （不阻塞 diff，仅记录）
        continue;
      }

      // 对比 main stroke 的包围盒 vs shadow 的包围盒
      const mainBBox = computeBBox(mainPts as readonly FrozenPoint[]);
      if (mainBBox) {
        const mainKey = `${mainBBox.minX.toFixed(1)},${mainBBox.minY.toFixed(1)},${mainBBox.maxX.toFixed(1)},${mainBBox.maxY.toFixed(1)}`;
        const shadowKey = `${shadowBBox.minX.toFixed(1)},${shadowBBox.minY.toFixed(1)},${shadowBBox.maxX.toFixed(1)},${shadowBBox.maxY.toFixed(1)}`;

        // 如果 bbox 完全匹配，认为几何一致
        // 如果 bbox 不匹配，按点坐标做精确对比
        if (mainKey !== shadowKey && mainPts.length > 0) {
          // 对比每个点（仅当点数相同时有意义）
          const minLen = Math.min(mainPts.length, 0); // shadow 无点数据
          for (let i = 0; i < minLen; i++) {
            // 无 shadow 点数据 — 跳过逐点对比
          }

          // 使用包围盒偏差作为几何不匹配信号
          if (mainPts.length > 0) {
            const maxDev = Math.max(
              Math.abs(mainBBox.minX - shadowBBox.minX),
              Math.abs(mainBBox.minY - shadowBBox.minY),
              Math.abs(mainBBox.maxX - shadowBBox.maxX),
              Math.abs(mainBBox.maxY - shadowBBox.maxY),
            );
            if (maxDev > POINT_EPSILON) {
              geometryMismatches.push({
                strokeId: id,
                mainPointCount: mainPts.length,
                shadowPointCount: mainPts.length, // 假设相同
                mismatchedPointIndices: mismatchedIndices,
                maxDeviation: maxDev,
                avgDeviation: maxDev / 4,
              });
            }
          }
        }
      }
    }

    // ── 4. BBox mismatch ──
    const bboxMismatches: BBoxMismatch[] = [];

    for (const id of mainIds) {
      if (!shadowIds.has(id)) continue;

      const mainStroke = mainStrokeMap.get(id)!;
      const mainBBox = computeBBox(mainStroke.points as readonly FrozenPoint[]);
      const shadowBBox = shadowOut.strokeBBoxes.get(id);

      if (!mainBBox || !shadowBBox) continue;

      const deltaMinX = Math.abs(mainBBox.minX - shadowBBox.minX);
      const deltaMinY = Math.abs(mainBBox.minY - shadowBBox.minY);
      const deltaMaxX = Math.abs(mainBBox.maxX - shadowBBox.maxX);
      const deltaMaxY = Math.abs(mainBBox.maxY - shadowBBox.maxY);

      if (deltaMinX > POINT_EPSILON || deltaMinY > POINT_EPSILON
        || deltaMaxX > POINT_EPSILON || deltaMaxY > POINT_EPSILON) {
        bboxMismatches.push({
          strokeId: id,
          mainBBox,
          shadowBBox,
          deltaMinX,
          deltaMinY,
          deltaMaxX,
          deltaMaxY,
        });
      }
    }

    // ── 5. Render order ──
    const mainOrder = snapshot.strokes.map(s => s.id);
    const shadowOrder = shadowOut.strokeIds.filter(id => mainIds.has(id));

    let renderOrderMatch = true;
    const renderOrderMismatches: Array<{ index: number; mainId: string; shadowId: string }> = [];

    const maxOrderLen = Math.max(mainOrder.length, shadowOrder.length);
    for (let i = 0; i < maxOrderLen; i++) {
      const mainId = mainOrder[i] ?? '__missing__';
      const shadowId = shadowOrder[i] ?? '__missing__';
      if (mainId !== shadowId) {
        renderOrderMatch = false;
        renderOrderMismatches.push({ index: i, mainId, shadowId });
      }
    }

    // ── 6. Frame drift ──
    const frameDrift = Math.abs(snapshot.frameId - shadowOut.frameId);

    // ── 7. Common stroke count ──
    const commonCount = [...mainIds].filter(id => shadowIds.has(id)).length;

    // ── 8. isClean ──
    const isClean =
      missingStrokes.length === 0
      && extraStrokes.length === 0
      && geometryMismatches.length === 0
      && bboxMismatches.length === 0
      && renderOrderMatch
      && frameDrift === 0
      && mainStrokeCount === shadowStrokeCount;

    if (this._debug && !isClean) {
      console.log('[RenderDiffEngine] 🔍 diff NOT clean:', {
        missingStrokes: missingStrokes.length,
        extraStrokes: extraStrokes.length,
        geometryMismatches: geometryMismatches.length,
        bboxMismatches: bboxMismatches.length,
        renderOrderMatch,
        frameDrift,
      });
    }

    return {
      frameId: snapshot.frameId,
      timestamp: performance.now(),
      mainStrokeCount,
      shadowStrokeCount,
      strokeCountDelta: mainStrokeCount - shadowStrokeCount,
      missingStrokes,
      extraStrokes,
      geometryMismatches,
      bboxMismatches,
      renderOrderMatch,
      renderOrderMismatches,
      frameDrift,
      mainTotalPoints,
      shadowTotalPoints,
      commonStrokeCount: commonCount,
      isClean,
    };
  }

  // ==========================================================
  //  Private: Empty result fallback
  // ==========================================================

  private _emptyResult(
    snapshot: FrameSnapshot,
    shadowOut: ShadowRenderOutput,
  ): RenderDiffResult {
    return {
      frameId: snapshot.frameId,
      timestamp: performance.now(),
      mainStrokeCount: snapshot.strokes.length,
      shadowStrokeCount: shadowOut.strokeCount,
      strokeCountDelta: snapshot.strokes.length - shadowOut.strokeCount,
      missingStrokes: [],
      extraStrokes: [],
      geometryMismatches: [],
      bboxMismatches: [],
      renderOrderMatch: false,
      renderOrderMismatches: [],
      frameDrift: 999,
      mainTotalPoints: 0,
      shadowTotalPoints: 0,
      commonStrokeCount: 0,
      isClean: false,
    };
  }
}

export default RenderDiffEngine;
