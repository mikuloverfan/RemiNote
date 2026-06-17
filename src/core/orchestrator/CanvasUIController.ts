// ============================================================
//  CanvasUIController — Single UI Owner
//  The ONLY module allowed to call dashboard.mount() / destroy().
//
//  Rules:
//  🟥 Only this class calls V11MagneticDashboard.mount()
//  🟥 Only this class calls V11MagneticDashboard.destroy()
//  🟥 No other module touches dashboard lifecycle
//  🟥 Idempotent: mount() is safe to call multiple times
//
//  Call chain:
//    CanvasView.onOpen()     → uiController.mount(layoutEl)
//    RuntimeOrchestrator     → uiController.update(data)
//    RuntimeOrchestrator     → uiController.tickAnimation()
//    RuntimeOrchestrator     → uiController.ensureStable()
//    CanvasView.onClose()    → uiController.destroy()
// ============================================================

import { V11MagneticDashboard } from '../shadow/ui/V11MagneticDashboard';

// Re-export for consumers
export type { V11MagneticDashboard } from '../shadow/ui/V11MagneticDashboard';

/** Dashboard input data shape (matches V11MagneticDashboard.update parameter). */
interface DashboardInput {
  integrity: number;
  pixelStability: number;
  gpuFidelity: number;
  systemHealth: number;
  mode: string;
  policyDecision: string;
  rootCause?: { type: string; confidence: number; strokes: Array<{ id: string; score: number }> };
  frameHistory: Array<'green' | 'yellow' | 'red'>;
}

// ============================================================
//  CanvasUIController
// ============================================================

export class CanvasUIController {
  private dashboard: V11MagneticDashboard | null = null;
  private _mountedContainer: HTMLElement | null = null;
  private _destroyed = false;

  // ==========================================================
  //  Lifecycle
  // ==========================================================

  /**
   * 🟥 SINGLE MOUNT ENTRY — the only place dashboard.mount() is called.
   * Idempotent: safe to call multiple times (re-mounts to new container).
   *
   * @param container The DOM element to mount into (typically .reminote-canvas-layout)
   */
  mount(container: HTMLElement): void {
    if (this._destroyed) {
      console.warn('[CanvasUIController] mount() called after destroy — ignored');
      return;
    }

    // Lazy-create dashboard on first mount
    if (!this.dashboard) {
      this.dashboard = new V11MagneticDashboard();
    }

    // Idempotent: if already mounted to same container, skip
    if (this.dashboard.mounted && this._mountedContainer === container) {
      return;
    }

    // Mount (V11MagneticDashboard.mount handles unmountDOM internally)
    this.dashboard.mount(container);
    this._mountedContainer = container;
  }

  /**
   * Update dashboard data. Safe to call before mount() — no-op if not mounted.
   */
  update(data: DashboardInput): void {
    if (!this.dashboard) return;
    this.dashboard.update(data);
  }

  /**
   * Drive spring animation tick. Safe to call before mount().
   */
  tickAnimation(): void {
    if (!this.dashboard) return;
    if (typeof this.dashboard.tickAnimation === 'function') {
      this.dashboard.tickAnimation();
    }
  }

  /**
   * 🟦 Ensure UI is stable — used by RuntimeOrchestrator RECOVERY step.
   * Checks DOM presence and re-mounts if detached.
   * Does NOT create new dashboard or change container.
   */
  ensureStable(): void {
    if (!this.dashboard || !this.dashboard.mounted) return;

    const btn = document.querySelector('.v11-mb');
    const pnl = document.querySelector('.v11-pn');

    // If DOM elements exist and are attached, stable
    if (btn && pnl && document.contains(btn) && document.contains(pnl)) {
      return;
    }

    // DOM detached — re-mount to last known container
    const container = this._mountedContainer
      || document.querySelector('.reminote-canvas-layout') as HTMLElement
      || document.body;

    if (container) {
      this.dashboard.mount(container);
      this._mountedContainer = container;
    }
  }

  /**
   * 🟥 Destroy UI completely. Called by CanvasView.onClose().
   * After this, mount() is blocked.
   */
  destroy(): void {
    if (this.dashboard) {
      this.dashboard.destroy();
      this.dashboard = null;
    }
    this._mountedContainer = null;
    this._destroyed = true;
  }

  // ==========================================================
  //  Query
  // ==========================================================

  get isMounted(): boolean {
    return this.dashboard?.mounted ?? false;
  }

  /**
   * 🟦 Pure render from FrameResult — UI reacts, never controls.
   * Replaces update(data) for the frame-contract model.
   */
  renderFromFrame(result: {
    frameId: number;
    uiHash: string;
    stability: 'PASS' | 'FAIL';
    metrics: { pixelDiff: number; gpuDiff: number; shadowDiff: number };
    strokeCount: number;
  }): void {
    if (!this.dashboard) return;

    // Only update if mounted — pure display, no mount trigger
    this.dashboard.update({
      integrity: 1 - result.metrics.pixelDiff,
      pixelStability: 1 - result.metrics.pixelDiff,
      gpuFidelity: 1 - result.metrics.gpuDiff,
      systemHealth: result.stability === 'PASS' ? 1 : 0.3,
      mode: result.stability === 'PASS' ? 'HEALTHY' : 'UNSTABLE',
      policyDecision: result.stability,
      rootCause: undefined,
      frameHistory: [result.stability === 'PASS' ? 'green' : 'red'],
    });
  }

  get isDestroyed(): boolean {
    return this._destroyed;
  }

  /** Access underlying dashboard for backward-compat (e.g., _lastData). */
  getDashboard(): V11MagneticDashboard | null {
    return this.dashboard;
  }
}

export default CanvasUIController;
