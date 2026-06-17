// ============================================================
//  ThumbnailCache — Page Thumbnail 缓存与脏标记系统
//  为 Phase 2 offscreen render 准备数据层
//
//  核心职责：
//  ✔ 记录 page 级别脏标记
//  ✔ 缓存 page thumbnail metadata (image, size, timestamp)
//  ✔ 与 Workspace / Renderer / Engine 完全解耦
//  ✔ 不触发任何 canvas draw
//  ✔ Workspace 仍是唯一数据源
//
//  脏标记规则（供 Phase 2 消费）：
//  - Workspace stroke add/update/delete → markDirty(pageId)
//  - page switch → markDirty(activePageId)
//  - load notebook → markAllDirty()
//
//  ⚠️  此阶段不集成到任何现有模块
//     仅提供 API，供 Phase 2 外部调用
// ============================================================

// ============================================================
//  PageThumbnail — 页面缩略图元数据
// ============================================================

interface PageThumbnail {
  /** 关联的 page ID */
  pageId: string;
  /** 缩略图数据（base64 data URL 或 blob URL），null 表示尚未生成 */
  image: string | null;
  /** 缩略图宽度（CSS pixels） */
  width: number;
  /** 缩略图高度（CSS pixels） */
  height: number;
  /** 最后更新时间（Date.now() 毫秒时间戳） */
  updatedAt: number;
  /** 脏标记：true 表示需要重新生成缩略图 */
  dirty: boolean;
}

// ============================================================
//  ThumbnailCache — 核心单例
// ============================================================

class ThumbnailCache {
  private _cache = new Map<string, PageThumbnail>();

  /**
   * 获取 page 的缩略图缓存。
   * @returns PageThumbnail 如果存在，否则 undefined
   */
  get(pageId: string): PageThumbnail | undefined {
    return this._cache.get(pageId);
  }

  /**
   * 写入缩略图缓存。
   * 传入的 thumb 对象会被直接存储（不会深拷贝）。
   */
  set(pageId: string, thumb: PageThumbnail): void {
    this._cache.set(pageId, thumb);
  }

  /**
   * 标记指定 page 的缩略图为脏。
   * - 如果已有缓存条目：设置 dirty = true
   * - 如果尚无缓存条目：创建占位条目（image = null, dirty = true）
   *
   * 调用时机（Phase 2）：
   * - Workspace stroke add/update/delete
   * - page switch
   */
  markDirty(pageId: string): void {
    const existing = this._cache.get(pageId);
    if (existing) {
      existing.dirty = true;
    } else {
      this._cache.set(pageId, {
        pageId,
        image: null,
        width: 0,
        height: 0,
        updatedAt: Date.now(),
        dirty: true,
      });
    }
  }

  /**
   * 标记所有已缓存 page 为脏。
   *
   * 调用时机（Phase 2）：
   * - load notebook
   */
  markAllDirty(): void {
    for (const thumb of this._cache.values()) {
      thumb.dirty = true;
    }
  }

  /**
   * 清除单个 page 的缓存条目。
   * 调用时机：page 被删除。
   */
  clear(pageId: string): void {
    this._cache.delete(pageId);
  }

  /**
   * 清除全部缓存。
   * 调用时机：session destroy / plugin unload。
   */
  clearAll(): void {
    this._cache.clear();
  }

  /**
   * 获取所有标记为脏的 page ID 列表。
   * Phase 2 render 将消费此列表确定哪些 page 需要重新生成缩略图。
   */
  getDirtyPages(): string[] {
    const result: string[] = [];
    for (const [pageId, thumb] of this._cache) {
      if (thumb.dirty) result.push(pageId);
    }
    return result;
  }

  /** 当前缓存条目数（含占位条目）。 */
  get size(): number {
    return this._cache.size;
  }

  /** 检查指定 page 是否有缓存条目。 */
  has(pageId: string): boolean {
    return this._cache.has(pageId);
  }
}

// ============================================================
//  Export — 全局单例
// ============================================================

export const thumbnailCache = new ThumbnailCache();
export type { PageThumbnail };
