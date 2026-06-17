// ============================================================
//  Render Ground Truth Tap — 最小侵入式 CPU 渲染输出观测器
//
//  解决的问题：
//  当前 Arbitration 系统比较的是 snapshot vs snapshot（自证），
//  因为 normalizeCPUOutput(snapshot) 从同一 snapshot 构造 CPU 输出。
//  这导致系统无法验证 "CPU 是否真实正确渲染了数据"。
//
//  方案：
//  在 main.ts renderFrame() 完成后，捕获 RenderQueue 的实际内容 —
//  即 CPU 到底画了哪些 stroke、什么顺序、什么 camera。
//  这是 main.ts 渲染的真实输出，独立于 FrameSnapshot。
//
//  插入点（main.ts, 仅 3 行）：
//  ┌─────────────────────────────────────────────────────────┐
//  │ // CanvasSession 属性:                                   │
//  │ private _renderTap: RenderGroundTruthTap | null = null;  │
//  │                                                         │
//  │ // 构造函数末尾:                                          │
//  │ this._renderTap = new RenderGroundTruthTap();            │
//  │                                                         │
//  │ // _unifiedTick() 中 renderFrame() 之后:                  │
//  │ this._renderTap?.capture(this.renderQueue,              │
//  │   this.viewport.camera, this.inputSnapshot);            │
//  └─────────────────────────────────────────────────────────┘
//
//  不修改任何渲染逻辑 — renderFrame() 内部代码完全不动。
// ============================================================

import type { FrameFence } from './FrameBarrier';

// ============================================================
//  Types
// ============================================================

/** CPU 实际渲染的一帧输出 — 来自 RenderQueue */
export interface RenderTapOutput {
  /** 与 FrameBarrier 对齐的 frameId（调用方传入） */
  frameId: number;
  /** 实际渲染的 stroke ID 列表（按渲染顺序） */
  renderedStrokeIds: string[];
  /** 实际渲染的 stroke 数量 */
  renderedStrokeCount: number;
  /** 是否包含 preview stroke */
  previewStrokeIncluded: boolean;
  /** preview stroke ID（如果包含） */
  previewStrokeId: string | null;
  /** 渲染时使用的 camera */
  camera: { x: number; y: number; zoom: number };
  /** 捕获时间戳 */
  capturedAt: number;
}

/** 与 FrameSnapshot 的对比结果 — 这是拼图缺失的那一块 */
export interface RenderVsSnapshotDiff {
  /** snapshot 中的 stroke 数 */
  snapshotStrokeCount: number;
  /** 实际渲染的 stroke 数 */
  renderedStrokeCount: number;
  /** 在 snapshot 中但未被渲染的 stroke ID */
  missingFromRender: string[];
  /** 被渲染但不在 snapshot 中的 stroke ID */
  extraInRender: string[];
  /** 渲染顺序与 snapshot 是否一致 */
  orderMatch: boolean;
  /** 是否完全一致 */
  consistent: boolean;
}

// ============================================================
//  RenderGroundTruthTap
// ============================================================

export class RenderGroundTruthTap {
  private _enabled = false;
  private _lastOutput: RenderTapOutput | null = null;
  private _frameBarrier: { currentFrameId: number } | null = null;

  enable(): void { this._enabled = true; }
  disable(): void { this._enabled = false; }
  get enabled(): boolean { return this._enabled; }

  /** 注入 FrameBarrier 引用（用于 frameId 对齐） */
  bindFrameBarrier(barrier: { currentFrameId: number }): void {
    this._frameBarrier = barrier;
  }

  // ==========================================================
  //  capture — 唯一观测入口
  // ==========================================================

  /**
   * 从 main.ts renderFrame() 完成后捕获实际渲染输出。
   *
   * 调用时机：renderFrame() 中 renderer.draw() 之后。
   *
   * @param renderQueue    CanvasSession.renderQueue（含 renderables[]）
   * @param camera         当前 viewport.camera
   * @param inputSnapshot  CanvasSession.inputSnapshot（读 previewStroke）
   * @returns              RenderTapOutput（CPU 实际渲染内容）
   */
  capture(
    renderQueue: {
      renderables: readonly (RenderableLike | null)[];
    },
    camera: { x: number; y: number; zoom: number },
    inputSnapshot: {
      previewStroke: { id: string } | null;
    },
  ): RenderTapOutput | null {
    if (!this._enabled) return null;

    const frameId = this._frameBarrier?.currentFrameId ?? 0;

    const renderedIds: string[] = [];
    for (const r of renderQueue.renderables) {
      if (r && r.id) {
        renderedIds.push(r.id);
      }
    }

    const previewId = inputSnapshot.previewStroke?.id ?? null;
    const previewIncluded = previewId !== null && renderedIds.includes(previewId);

    const output: RenderTapOutput = {
      frameId,
      renderedStrokeIds: renderedIds,
      renderedStrokeCount: renderedIds.length,
      previewStrokeIncluded: previewIncluded,
      previewStrokeId: previewIncluded ? previewId : null,
      camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
      capturedAt: performance.now(),
    };

    this._lastOutput = output;
    return output;
  }

  // ==========================================================
  //  verify — 对比实际渲染 vs snapshot（缺失的拼图）
  // ==========================================================

  /**
   * 对比 CPU 实际渲染输出与 FrameSnapshot。
   *
   * 这是当前系统缺失的验证：
   * - snapshot 说 "有 10 笔 stroke"
   * - renderQueue 说 "实际渲染了 9 笔"
   * → 有 1 笔 stroke 在数据中存在但未被渲染
   *
   * @param tapOutput    capture() 的输出
   * @param snapshotIds  FrameSnapshot 中的 stroke ID 列表
   * @returns            RenderVsSnapshotDiff
   */
  verify(
    tapOutput: RenderTapOutput,
    snapshotIds: string[],
  ): RenderVsSnapshotDiff {
    const snapshotSet = new Set(snapshotIds);
    const renderedSet = new Set(tapOutput.renderedStrokeIds);

    const missingFromRender: string[] = [];
    for (const id of snapshotSet) {
      if (!renderedSet.has(id)) missingFromRender.push(id);
    }

    const extraInRender: string[] = [];
    for (const id of renderedSet) {
      if (!snapshotSet.has(id)) extraInRender.push(id);
    }

    // 渲染顺序对比
    let orderMatch = true;
    const minLen = Math.min(snapshotIds.length, tapOutput.renderedStrokeIds.length);
    for (let i = 0; i < minLen; i++) {
      if (snapshotIds[i] !== tapOutput.renderedStrokeIds[i]) {
        orderMatch = false;
        break;
      }
    }

    const consistent =
      missingFromRender.length === 0
      && extraInRender.length === 0
      && tapOutput.renderedStrokeCount === snapshotIds.length
      && orderMatch;

    return {
      snapshotStrokeCount: snapshotIds.length,
      renderedStrokeCount: tapOutput.renderedStrokeCount,
      missingFromRender,
      extraInRender,
      orderMatch,
      consistent,
    };
  }

  // ==========================================================
  //  Query
  // ==========================================================

  get lastOutput(): RenderTapOutput | null {
    return this._lastOutput;
  }
}

// ============================================================
//  Minimal interface for main.ts RenderQueue
// ============================================================

/** main.ts RenderQueue.renderables 的元素类型（最小接口） */
interface RenderableLike {
  id: string;
  path2D?: Path2D;
  style?: { color: string; lineWidth: number };
  _sourcePoints?: readonly { x: number; y: number }[];
}

// ============================================================
//  集成说明（main.ts 3 行变更）
// ============================================================
//
//  CanvasSession 中添加:
//
//    import { RenderGroundTruthTap } from '../src/core/shadow/RenderGroundTruthTap';
//
//    // Property:
//    private _renderTap: RenderGroundTruthTap | null = null;
//
//    // Constructor末尾 (在 renderScheduler.start() 之后):
//    this._renderTap = new RenderGroundTruthTap();
//    this._renderTap.enable();
//
//    // _unifiedTick() 中 renderFrame() 之后:
//    this._renderTap?.capture(this.renderQueue, this.viewport.camera, this.inputSnapshot);
//
//    // destroy() 中:
//    this._renderTap?.disable();
//    this._renderTap = null;
//
//  FrameBarrier 对齐（在 ShadowSessionHook 或 FrameBarrier 注入时）:
//    tap.bindFrameBarrier(frameBarrier);
//
//  Arbitration 集成（在 ArbitrationEngine.arbitrate() 中增加参数）:
//    const renderVsSnapshot = tap.verify(tapOutput, snapshot.strokes.map(s => s.id));
//    // renderVsSnapshot.consistent → 纳入 confidence 计算
//    // renderVsSnapshot.missingFromRender → 根本性问题，标记 red
//
//  ⚠️ 以上是集成所需的全部变更。
//     renderFrame() 内部一行不改。
//     RenderQueue 只读访问。
//     不触发任何副作用。

// ============================================================
//  关键问题回答
// ============================================================

/**
 * Q: 当前系统缺的"唯一一块拼图"是否就是 render output verification？
 *
 * A: YES.
 *
 * 理由（基于代码结构）：
 *
 * 1. ArbitrationEngine._arbitrateInternal() 第 181 行:
 *    `const cpu = normalizeCPUOutput(snapshot);`
 *    这行代码从 snapshot 构造 CPU 输出，而不是从 main.ts 的 renderFrame()
 *    实际输出构造。这使 CPU vs Shadow vs GPU 的比较变成了
 *    "snapshot vs snapshot vs snapshot"（自证循环）。
 *
 * 2. FrameBarrier 保证了 snapshot 的一致性（三路读同一份数据），
 *    但没有保证 CPU renderFrame() 使用了 snapshot 中的数据。
 *    CPU renderFrame() 读的是 this.engine.strokes（line 2889），
 *    而 snapshot 捕获的是 beginFrame() 时的 engine.strokes。
 *    如果这之间有 mutation（例如 eraser pointermove），
 *    两者不同，但系统无法检测。
 *
 * 3. RenderGroundTruthTap 填补了这个缺口：
 *    它从 RenderQueue（CPU 实际渲染的 stroke 列表）捕获输出，
 *    与 FrameSnapshot 对比。如果 renderQueue 中有 snapshot 不包含的 stroke，
 *    或者 snapshot 中有 renderQueue 未渲染的 stroke，
 *    → 这是根本性不一致，应当标记为 red。
 *
 * 4. 这不是一个新系统 — 它是一个观测点。
 *    它不修改任何渲染路径，不引入新的数据流。
 *    它只是从已有的 RenderQueue 中读取 CPU 实际画了什么。
 *
 * 5. 有了这个 Tap，Arbitration 才能从 "snapshot consistency verification"
 *    升级为 "render correctness verification"。
 */

export default RenderGroundTruthTap;
