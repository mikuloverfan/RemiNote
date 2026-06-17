// ============================================================
//  StrokePathCache — Path2D 几何路径缓存
//  每个 strokeId 对应唯一 Path2D 实例，避免重复 buildPath2D
//
//  职责：
//  ✔ get / set / invalidate / invalidateAll
//  ✔ 不参与 render 决策
//  ✔ 不依赖 engine / workspace / scheduler
// ============================================================

class StrokePathCache {
  private _cache = new Map<string, Path2D>();
  private _generation = 0;
  private _workspaceId = '';

  get(id: string): Path2D | undefined {
    return this._cache.get(id);
  }

  /** 写入 Path2D 缓存。 */
  set(id: string, path: Path2D): void {
    this._cache.set(id, path);
  }

  /** 作废单个 stroke 的缓存（updateStroke 触发）。 */
  invalidate(id: string): void {
    this._cache.delete(id);
  }

  /** 🔴 Phase 0.3.5: workspace-scoped hard wipe + generation bump */
  reset(workspaceId: string): void {
    this._cache.clear();
    this._workspaceId = workspaceId;
    this._generation++;
  }

  /** 🔴 Phase 0.3.5: 强制清空全部缓存 + generation bump */
  clearAll(): void {
    this._cache.clear();
    this._generation++;
  }

  /** 作废全部缓存（page load / camera reset / session destroy）。 */
  invalidateAll(): void {
    this._cache.clear();
  }

  /** 当前缓存条目数。 */
  get size(): number {
    return this._cache.size;
  }
}

export { StrokePathCache };
