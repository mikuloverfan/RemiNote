// ============================================================
//  RenderScheduler — 全局单例，统一管理所有 render 请求
// ============================================================

import { dirtyTracker } from './DirtyTracker';
import { thumbnailBridge } from '../thumbnail/ThumbnailBridge';
import { offscreenThumbnailRenderer } from '../thumbnail/OffscreenThumbnailRenderer';
import LogManager from '../debug/LogManager';

class RenderScheduler {
  private static _instance: RenderScheduler;

  static get instance(): RenderScheduler {
    if (!this._instance) this._instance = new RenderScheduler();
    return this._instance;
  }

  private _pending = false;
  private _scheduled = false;
  private _renderer: any = null;
  private _recoveryFn: (() => any) | null = null;

  setRenderer(renderer: any): void { this._renderer = renderer; }
  setRecovery(fn: (() => any) | null): void { this._recoveryFn = fn; }

  requestRender(): void {
    this._pending = true;
    if (this._scheduled) return;
    this._scheduled = true;
    LogManager.debug("lifecycle", "RenderScheduler scheduling RAF");
    requestAnimationFrame(() => this.flush());
  }

  private flush(): void {
    this._scheduled = false;

    const pages = thumbnailBridge.consumeDirtyPages();
    if (pages.length > 0) offscreenThumbnailRenderer.renderBatch(pages);

    if (!this._pending || !this._renderer) return;
    this._pending = false;

    const dirty = dirtyTracker.consume();
    this._renderer.renderFrame(dirty);
  }

  reset(): void {
    this._pending = false;
    this._scheduled = false;
    this._renderer = null;
  }
}

export const renderScheduler = RenderScheduler.instance;
