// ============================================================
//  InputGuard �?输入安全调试工具（不参与核心输入控制链路�?
//
//  原则�?
//  - 输入隔离依赖 DOM 结构，不依赖运行时判�?
//  - Canvas 是唯一输入源，UI 永远不会进入输入链路
//  - InputGuard 仅用于开发期调试/诊断，不阻断任何逻辑
// ============================================================

/** Debug mode �?开发期保护，发布前设为 false */
export const DEBUG_INPUT: boolean = true;

/** Registry of currently active canvas elements (debug use only). */
const _canvasRegistry = new Set<HTMLCanvasElement>();

export const InputGuard = {
  // ==========================================================
  //  Canvas Registration (debug only)
  // ==========================================================

  /** Register a canvas. Called on session create. */
  registerCanvas(canvas: HTMLCanvasElement): void {
    _canvasRegistry.add(canvas);
    if (DEBUG_INPUT) {
      LogManager.log("workspace", `[InputGuard] �?canvas registered (total: ${_canvasRegistry.size})`);
    }
  },

  /** Unregister a canvas. Called on session destroy. */
  unregisterCanvas(canvas: HTMLCanvasElement): void {
    _canvasRegistry.delete(canvas);
    if (DEBUG_INPUT) {
      LogManager.log("workspace", `[InputGuard] 🗑  canvas unregistered (remaining: ${_canvasRegistry.size})`);
    }
  },

  /** Check if any canvas is registered (debug query). */
  hasActiveCanvas(): boolean {
    return _canvasRegistry.size > 0;
  },

  get canvasCount(): number {
    return _canvasRegistry.size;
  },

  // ==========================================================
  //  Draw Guard �?开发期诊断，不阻断执行
  // ==========================================================

  /**
   * Debug-only draw guard.
   * Logs a warning if draw logic runs with no active canvas,
   * but NEVER blocks execution.
   *
   * @returns always true �?this is a diagnostic, not a gate
   */
  guardDraw(label: string): boolean {
    if (_canvasRegistry.size === 0 && DEBUG_INPUT) {
      LogManager.warn("workspace", 
        `[InputGuard] 🔍 DRAW DIAGNOSTIC: "${label}" called with NO active canvas`,
      );
      console.trace('[InputGuard] Stack trace:');
    }
    // Always allow �?structural isolation makes runtime checks unnecessary
    return true;
  },

  // ==========================================================
  //  SAFE_UI_LAYER �?文档标记（不影响运行时）
  // ==========================================================

  /**
   * Mark a listener as SAFE_UI_LAYER.
   * Pure documentation �?no runtime effect.
   */
  markSafeUIListener<T extends Function>(fn: T, label: string): T {
    (fn as unknown as Record<string, unknown>).__safe_ui_layer = label;
    if (DEBUG_INPUT) {
      LogManager.log("workspace", `[InputGuard] 🏷  SAFE_UI_LAYER: ${label}`);
    }
    return fn;
  },

  /** Check if a listener was marked as SAFE_UI_LAYER. */
  isSafeUIListener(fn: Function): boolean {
    return !!(fn as unknown as Record<string, unknown>).__safe_ui_layer;
  },

  // ==========================================================
  //  Lifecycle
  // ==========================================================

  /** Full reset �?deregister all canvases. Use only in plugin unload. */
  reset(): void {
    if (DEBUG_INPUT && _canvasRegistry.size > 0) {
      LogManager.warn("workspace", 
        `[InputGuard] 🔴 reset() called with ${_canvasRegistry.size} canvases still registered`,
      );
    }
    _canvasRegistry.clear();
  },
} as const;
