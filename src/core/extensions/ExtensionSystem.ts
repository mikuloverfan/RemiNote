// ============================================================
//  ExtensionSystem — 安全扩展点
//  原则：扩展可以崩，主渲染不能动
//  ❌ 不修改 stroke / GPU / renderFrame
//  ✅ 仅观察 + 附加行为
// ============================================================

// ---- Types ----

export interface RenderContext {
  strokeCount: number;
  totalPoints: number;
  camera: { x: number; y: number; zoom: number };
}

export type RenderHook = (ctx: RenderContext) => void;
export type PointerHook = (e: PointerEvent) => void;
export type ToolHook = (tool: string) => void;

export interface ExtensionPoint {
  id: string;
  beforeRender?: RenderHook;
  afterRender?: RenderHook;
  onPointerDown?: PointerHook;
  onPointerMove?: PointerHook;
  onPointerUp?: PointerHook;
  onToolChange?: ToolHook;
}

// ---- System ----

class ExtensionSystem {
  private _extensions: ExtensionPoint[] = [];
  private _enabled = true;
  private _debugTrace = false;

  register(ext: ExtensionPoint): void {
    if (!ext.id) return;
    const exists = this._extensions.find(e => e.id === ext.id);
    if (exists) {
      // Replace silently
      this._extensions = this._extensions.filter(e => e.id !== ext.id);
    }
    this._extensions.push(ext);
  }

  unregister(id: string): void {
    this._extensions = this._extensions.filter(e => e.id !== id);
  }

  setEnabled(v: boolean): void { this._enabled = v; }
  setDebugTrace(v: boolean): void { this._debugTrace = v; }

  // ---- Safe invocation helpers ----

  private _safeCall(hook: Function | undefined, label: string, ctx?: any): void {
    if (!this._enabled || !hook) return;
    try {
      if (this._debugTrace) console.log(`[Extension] ${label}`);
      hook(ctx);
    } catch (e) {
      // 🔒 失败隔离：扩展错误不影响主流程
      console.warn(`[Extension] ${label} FAILED (isolated):`, e);
    }
  }

  private _broadcast<K extends keyof Omit<ExtensionPoint, 'id'>>(
    event: K,
    arg?: any,
  ): void {
    for (const ext of this._extensions) {
      const hook = ext[event] as Function | undefined;
      this._safeCall(hook, `${ext.id}:${event}`, arg);
    }
  }

  // ---- Public API ----

  /** renderFrame 之前调用（RenderScheduler.flush 中） */
  beforeRender(ctx: RenderContext): void {
    this._broadcast('beforeRender', ctx);
  }

  /** renderFrame 之后调用 */
  afterRender(ctx: RenderContext): void {
    this._broadcast('afterRender', ctx);
  }

  /** pointerdown 时调用 */
  onPointerDown(e: PointerEvent): void {
    this._broadcast('onPointerDown', e);
  }

  /** pointermove 时调用 */
  onPointerMove(e: PointerEvent): void {
    this._broadcast('onPointerMove', e);
  }

  /** pointerup 时调用 */
  onPointerUp(e: PointerEvent): void {
    this._broadcast('onPointerUp', e);
  }

  /** tool 切换时调用 */
  onToolChange(tool: string): void {
    this._broadcast('onToolChange', tool);
  }

  get extensionCount(): number { return this._extensions.length; }
}

export const extensionSystem = new ExtensionSystem();

// ---- Convenience: window control ----
if (typeof window !== 'undefined') {
  (window as any).__EXT = extensionSystem;
}
