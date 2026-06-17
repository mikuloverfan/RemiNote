// ============================================================
//  ThumbnailBridge — 响应式缩略图触发层
//  Workspace 事件 → dirty pages → RenderScheduler → OffscreenRenderer
//
//  核心职责（只做 4 件事）：
//  1️⃣ 接收 Workspace stroke 事件
//  2️⃣ 解析 strokeId → pageId
//  3️⃣ 合并 dirty pages（去重 + debounce）
//  4️⃣ 触发 RenderScheduler → batch render
//
//  数据流：
//  Workspace.emit('stroke:added' | 'updated' | 'deleted')
//       ↓
//  ThumbnailBridge.onWorkspaceEvent()
//       ↓
//  resolvePageId(strokeId) → pageId
//       ↓
//  dirtyPages.add(pageId)
//       ↓
//  debounce scheduleFlush()
//       ↓
//  RenderScheduler.requestRender()
//       ↓ (next RAF)
//  RenderScheduler.flush() → consumeDirtyPages()
//       ↓
//  OffscreenThumbnailRenderer.renderBatch()
//       ↓
//  ThumbnailCache.set()
//
//  约束：
//  ❌ 不直接调用 renderPage / renderBatch
//  ❌ 不在 stroke path 中执行 render
//  ❌ 不阻塞 drawing / input
// ============================================================

import type { IWorkspace } from '../workspace/IWorkspace';
import { renderScheduler } from '../render/RenderScheduler';

// ============================================================
//  WorkspaceEvent — 轻量事件结构（不依赖 WorkspaceImpl 类型）
// ============================================================

interface WorkspaceEvent {
  event: 'stroke:added' | 'stroke:updated' | 'stroke:deleted';
  strokeId: string;
}

// ============================================================
//  ThumbnailBridge
// ============================================================

class ThumbnailBridge {
  private _workspace: IWorkspace | null = null;
  private _currentPageId: string | null = null;
  private _dirtyPages = new Set<string>();
  private _scheduled = false;

  // ==========================================================
  //  Configuration
  // ==========================================================

  /** 绑定 Workspace 引用（只读，仅用于 resolvePageId 查询）。 */
  setWorkspace(ws: IWorkspace): void {
    this._workspace = ws;
  }

  /** 设置当前活跃 page ID（供 resolvePageId 回退）。 */
  setCurrentPage(pageId: string): void {
    this._currentPageId = pageId;
    // page switch 时标记该页为脏
    this._dirtyPages.add(pageId);
    this.scheduleFlush();
  }

  // ==========================================================
  //  1️⃣ 事件入口（由 WorkspaceImpl 调用）
  // ==========================================================

  /**
   * 接收 Workspace stroke 变更事件。
   * 每次 stroke add/update/delete 均触发，内部做去重合并。
   */
  onWorkspaceEvent(event: WorkspaceEvent): void {
    const pageId = this.resolvePageId(event.strokeId);
    if (!pageId) return;

    this._dirtyPages.add(pageId);
    this.scheduleFlush();
  }

  // ==========================================================
  //  2️⃣ stroke → pageId 解析
  // ==========================================================

  /**
   * 解析 stroke 所属 pageId。
   *
   * 策略：
   *  1. workspace.strokes.has(strokeId) → 属于当前 page
   *  2. fallback: currentPageId
   *  3. 否则返回 null（丢弃）
   */
  resolvePageId(strokeId: string): string | null {
    // ① 检查 workspace 中是否存在该 stroke
    if (this._workspace?.strokes.has(strokeId)) {
      return this._currentPageId;
    }

    // ② fallback: 返回当前 page（delete 事件后 stroke 已移除，但仍属于该页）
    return this._currentPageId;
  }

  // ==========================================================
  //  3️⃣ debounce flush
  // ==========================================================

  /**
   * 合并高频更新：同一帧内多次 mark dirty → 只触发一次 flush。
   * 使用 setTimeout(0) 让出主线程，不阻塞 pointermove。
   */
  scheduleFlush(): void {
    if (this._scheduled) return;
    this._scheduled = true;

    // setTimeout(0) — 非阻塞，下一微任务执行
    setTimeout(() => this._flush(), 0);
  }

  // ==========================================================
  //  4️⃣ flush — 触发 RenderScheduler
  // ==========================================================

  /**
   * 通知 RenderScheduler 有 dirty pages 待处理。
   * 实际渲染在下一帧 RAF 中由 RenderScheduler.flush() 驱动。
   */
  private _flush(): void {
    this._scheduled = false;

    if (this._dirtyPages.size === 0) return;

    // 触发主渲染循环 — 合并到下一帧 RAF
    renderScheduler.requestRender();
  }

  // ==========================================================
  //  consumeDirtyPages（供 RenderScheduler 消费）
  // ==========================================================

  /**
   * 消费并清空 dirty pages 列表。
   * 由 RenderScheduler.flush() 调用，获取需要重新生成缩略图的 page ID。
   *
   * @returns 去重后的 dirty page ID 数组
   */
  consumeDirtyPages(): string[] {
    const pages = Array.from(this._dirtyPages);
    this._dirtyPages.clear();
    return pages;
  }

  // ==========================================================
  //  Debug
  // ==========================================================

  /** 当前脏页数量（调试用）。 */
  get dirtyCount(): number {
    return this._dirtyPages.size;
  }

  /** 是否有待处理的 flush。 */
  get isScheduled(): boolean {
    return this._scheduled;
  }

  // ==========================================================
  //  Lifecycle
  // ==========================================================

  /** 清空所有状态（plugin unload）。 */
  destroy(): void {
    this._workspace = null;
    this._currentPageId = null;
    this._dirtyPages.clear();
    this._scheduled = false;
  }
}

// ============================================================
//  Export — 全局单例
// ============================================================

export const thumbnailBridge = new ThumbnailBridge();
export type { WorkspaceEvent };
