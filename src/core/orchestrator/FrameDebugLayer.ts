// ============================================================
//  Frame Debug Layer — Per-frame fully inspectable execution trace
//
//  Every frame produces a deterministic trace log with:
//  - Step-by-step ok/fail/duration
//  - DOM snapshot (cursor, dashboard, canvas presence)
//  - Raw metrics
//  - Errors indexed by step
//
//  Design principles:
//  🟥 Zero side effects — pure recording, never modifies state
//  🟥 Serializable — FrameTrace can be JSON.stringify'd for export
//  🟥 Ring-buffered — configurable max frames, auto-evict oldest
//  🟥 Queryable — getFrame(frameId), getLast(), getErrors()
// ============================================================

// ============================================================
//  Types
// ============================================================

/** Result of executing a single pipeline step. */
export interface StepResult {
  /** Whether the step completed without throwing. */
  ok: boolean;
  /** Wall-clock duration of this step in milliseconds. */
  durationMs: number;
  /** Error message if ok === false. */
  error?: string;
}

/** Snapshot of DOM-relevant UI elements at frame time. */
export interface FrameDOMSnapshot {
  /** CSS cursor class / dataset state */
  cursorState: string;
  /** Whether .v11-mb (dashboard button) exists in DOM */
  dashboardExists: boolean;
  /** Whether .reminote-canvas-wrapper exists in DOM */
  canvasMounted: boolean;
  /** Currently focused element tag name, or null */
  activeElement: string | null;
}

/** A per-frame error record. */
export interface FrameError {
  /** Which step produced the error */
  step: string;
  /** Error message */
  message: string;
  /** Timestamp (performance.now()) */
  timestamp: number;
}

/** Per-step trace results for all 5 pipeline phases. */
export interface FrameStepTraces {
  state: StepResult;
  render: StepResult;
  observe: StepResult;
  stability: StepResult;
  ui: StepResult;
}

/** Complete per-frame execution trace. */
export interface FrameTrace {
  /** Monotonic frame ID (1-based, assigned by orchestrator) */
  frameId: number;

  /** Per-step ok/fail/duration */
  steps: FrameStepTraces;

  /** DOM state snapshot captured after UI sync */
  dom: FrameDOMSnapshot;

  /** Raw observer metrics (pixelDiff, gpuDiff, shadowDiff) */
  metrics: {
    pixelDiff: number;
    gpuDiff: number;
    shadowDiff: number;
  };

  /** Errors collected during this frame */
  errors: FrameError[];

  /** Frame timestamp (performance.now()) */
  timestamp: number;
}

/** Configuration for FrameDebugLayer. */
export interface FrameDebugConfig {
  /** Maximum frames to retain in ring buffer (default 300 = ~5s at 60fps) */
  maxFrames?: number;
  /** Log every frame to console (default false) */
  verbose?: boolean;
  /** Auto-dump trace on any step failure (default true) */
  autoDumpOnError?: boolean;
}

// ============================================================
//  Defaults
// ============================================================

const DEFAULT_CONFIG: Required<FrameDebugConfig> = {
  maxFrames: 300,
  verbose: false,
  autoDumpOnError: true,
};

// ============================================================
//  Pure Functions
// ============================================================

/**
 * Execute a named pipeline step, returning a StepResult with timing.
 * 🟥 Catches all exceptions — never throws.
 *
 * @param name    Step name (for error attribution)
 * @param fn      Synchronous step function
 * @param onError Optional callback invoked with the error (before StepResult is returned)
 */
export function runStep(
  name: string,
  fn: () => void,
  onError?: (err: unknown) => void,
): StepResult {
  const start = performance.now();
  try {
    fn();
    const durationMs = performance.now() - start;
    return { ok: true, durationMs };
  } catch (err) {
    const durationMs = performance.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    onError?.(err);
    return { ok: false, durationMs, error: message };
  }
}

/**
 * Capture a snapshot of DOM-relevant UI state.
 * Pure read-only — never mutates DOM.
 */
export function captureDOM(): FrameDOMSnapshot {
  try {
    const body = typeof document !== 'undefined' ? document.body : null;

    return {
      cursorState: body?.dataset?.cursor
        || (typeof document !== 'undefined' && document.querySelector('.reminote-cursor-overlay') ? 'mounted' : 'unknown'),
      dashboardExists: typeof document !== 'undefined'
        ? !!(document.querySelector('.v11-mb') && document.querySelector('.v11-pn'))
        : false,
      canvasMounted: typeof document !== 'undefined'
        ? !!document.querySelector('.reminote-canvas-wrapper')
        : false,
      activeElement: body && document.activeElement
        ? document.activeElement.tagName || null
        : null,
    };
  } catch {
    return {
      cursorState: 'error',
      dashboardExists: false,
      canvasMounted: false,
      activeElement: null,
    };
  }
}

// ============================================================
//  FrameDebugLayer
// ============================================================

export class FrameDebugLayer {
  private config: Required<FrameDebugConfig>;
  private frames: FrameTrace[] = [];
  private totalFrames = 0;

  constructor(config: FrameDebugConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==========================================================
  //  Logging
  // ==========================================================

  /**
   * Log a completed frame trace.
   * Automatically checks for step failures and emits warnings.
   */
  log(trace: FrameTrace): void {
    this.totalFrames++;
    this.frames.push(trace);

    // Ring buffer eviction
    while (this.frames.length > this.config.maxFrames) {
      this.frames.shift();
    }

    // Auto-warn on step failures
    if (this.config.autoDumpOnError) {
      if (!trace.steps.render.ok) {
        console.warn('[FrameDebugLayer] ⚠️ RENDER step failed', {
          frameId: trace.frameId,
          error: trace.steps.render.error,
          dom: trace.dom,
        });
      }
      if (!trace.steps.observe.ok) {
        console.warn('[FrameDebugLayer] ⚠️ OBSERVE step failed', {
          frameId: trace.frameId,
          error: trace.steps.observe.error,
        });
      }
      if (!trace.steps.stability.ok) {
        console.warn('[FrameDebugLayer] ⚠️ STABILITY step failed', {
          frameId: trace.frameId,
          error: trace.steps.stability.error,
        });
      }
      if (!trace.steps.ui.ok) {
        console.warn('[FrameDebugLayer] ⚠️ UI SYNC step failed', {
          frameId: trace.frameId,
          error: trace.steps.ui.error,
          dom: trace.dom,
        });
      }
      if (trace.errors.length > 0) {
        console.warn('[FrameDebugLayer] ⚠️ Frame has errors', {
          frameId: trace.frameId,
          errorCount: trace.errors.length,
          errors: trace.errors,
        });
      }
    }

    // Verbose logging
    if (this.config.verbose) {
      const totalMs =
        trace.steps.state.durationMs +
        trace.steps.render.durationMs +
        trace.steps.observe.durationMs +
        trace.steps.stability.durationMs +
        trace.steps.ui.durationMs;
      console.log(
        `[FrameDebugLayer] 📊 Frame #${trace.frameId} | ${totalMs.toFixed(2)}ms | ` +
        `S:${trace.steps.state.ok ? '✅' : '❌'} ` +
        `R:${trace.steps.render.ok ? '✅' : '❌'} ` +
        `O:${trace.steps.observe.ok ? '✅' : '❌'} ` +
        `T:${trace.steps.stability.ok ? '✅' : '❌'} ` +
        `U:${trace.steps.ui.ok ? '✅' : '❌'} | ` +
        `Dash:${trace.dom.dashboardExists ? 'Y' : 'N'} ` +
        `Canvas:${trace.dom.canvasMounted ? 'Y' : 'N'}`,
      );
    }
  }

  // ==========================================================
  //  Query
  // ==========================================================

  /** Get a trace by exact frameId. */
  getFrame(frameId: number): FrameTrace | undefined {
    return this.frames.find(f => f.frameId === frameId);
  }

  /** Get the most recent trace. */
  getLast(): FrameTrace | undefined {
    return this.frames.length > 0
      ? this.frames[this.frames.length - 1]
      : undefined;
  }

  /** Get last N traces (most recent first). */
  getRecent(n: number = 10): FrameTrace[] {
    return this.frames.slice(-n).reverse();
  }

  /** Get all traces with at least one failed step. */
  getErrors(): FrameTrace[] {
    return this.frames.filter(f =>
      !f.steps.state.ok ||
      !f.steps.render.ok ||
      !f.steps.observe.ok ||
      !f.steps.stability.ok ||
      !f.steps.ui.ok ||
      f.errors.length > 0,
    );
  }

  /** Get all frames where a specific step failed. */
  getStepErrors(step: keyof FrameStepTraces): FrameTrace[] {
    return this.frames.filter(f => !f.steps[step].ok);
  }

  /** Get traces within a frameId range (inclusive). */
  getRange(from: number, to: number): FrameTrace[] {
    return this.frames.filter(f => f.frameId >= from && f.frameId <= to);
  }

  /** Clear all stored traces. */
  clear(): void {
    this.frames = [];
  }

  /** Total frames logged (including evicted). */
  get totalFramesLogged(): number {
    return this.totalFrames;
  }

  /** Current buffer size. */
  get bufferSize(): number {
    return this.frames.length;
  }

  /** Export all traces as JSON string. */
  export(): string {
    return JSON.stringify(this.frames, null, 2);
  }

  /** Check if the last N frames were all clean (no errors). */
  isStable(windowSize: number = 60): boolean {
    const recent = this.frames.slice(-windowSize);
    if (recent.length === 0) return false;
    return recent.every(f =>
      f.steps.state.ok &&
      f.steps.render.ok &&
      f.steps.observe.ok &&
      f.steps.stability.ok &&
      f.steps.ui.ok &&
      f.errors.length === 0,
    );
  }

  /** Get aggregate stats over the buffered frames. */
  getStats(): {
    totalFrames: number;
    errorFrames: number;
    avgRenderMs: number;
    avgObserveMs: number;
    avgTotalMs: number;
    dashboardMissing: number;
    canvasMissing: number;
  } {
    const errFrames = this.getErrors().length;
    const total = this.frames.length || 1;

    let sumRender = 0, sumObserve = 0, sumTotal = 0;
    let dashMissing = 0, canvasMissing = 0;

    for (const f of this.frames) {
      sumRender += f.steps.render.durationMs;
      sumObserve += f.steps.observe.durationMs;
      sumTotal +=
        f.steps.state.durationMs +
        f.steps.render.durationMs +
        f.steps.observe.durationMs +
        f.steps.stability.durationMs +
        f.steps.ui.durationMs;
      if (!f.dom.dashboardExists) dashMissing++;
      if (!f.dom.canvasMounted) canvasMissing++;
    }

    return {
      totalFrames: this.totalFramesLogged,
      errorFrames: errFrames,
      avgRenderMs: sumRender / total,
      avgObserveMs: sumObserve / total,
      avgTotalMs: sumTotal / total,
      dashboardMissing: dashMissing,
      canvasMissing,
    };
  }
}

export default FrameDebugLayer;
