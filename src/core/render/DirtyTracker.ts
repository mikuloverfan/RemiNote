// ============================================================
//  DirtyTracker — 全局脏数据追踪系统
//  记录哪些 stroke 被修改，供 RenderScheduler / Renderer 使用
//
//  核心职责：
//  ✔ 记录 stroke 级别脏标记
//  ✔ 合并高频更新（pointermove）
//  ✔ 支持全量脏标记（delete / camera / page load）
//  ✔ 支持清空与批处理
// ============================================================

class DirtyTracker {
  private _dirtyStrokes = new Set<string>();
  private _fullDirty = false;

  /** 标记单个 stroke 为脏（addStroke / updateStroke）。 */
  markStrokeDirty(id: string): void {
    this._dirtyStrokes.add(id);
  }

  /** 标记全部为脏（deleteStroke / camera change / page load）。 */
  markAllDirty(): void {
    this._fullDirty = true;
  }

  /**
   * 消费当前脏数据并清空。
   * 调用方（RenderScheduler.flush）负责将结果传递给 Renderer。
   */
  consume(): { full: boolean; strokes: string[] } {
    if (this._fullDirty) {
      this._fullDirty = false;
      this._dirtyStrokes.clear();
      return { full: true, strokes: [] };
    }

    const result = Array.from(this._dirtyStrokes);
    this._dirtyStrokes.clear();

    return { full: false, strokes: result };
  }

  /** 清空所有脏标记（不消费）。 */
  clear(): void {
    this._dirtyStrokes.clear();
    this._fullDirty = false;
  }
}

export const dirtyTracker = new DirtyTracker();
