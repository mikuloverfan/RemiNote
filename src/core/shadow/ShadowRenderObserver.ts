// ============================================================
//  Shadow Render Layer — ShadowRenderObserver
//
//  职责：
//  ✔ 统一入口 — 对 main.ts 暴露单一 observe() 调用
//  ✔ 编排 Shadow 管线 — snapshot → render → diff
//  ✔ 安全边界 — 所有子系统崩溃不影响主系统
//  ✔ 启停控制 — enable/disable，默认 disabled
//  ✔ 历史记录 — 最近 N 帧的 diff 结果
//
//  架构：
//    main.ts _unifiedTick()
//        ↓ (在 renderFrame() 之后调用)
//    ShadowRenderObserver.observe(session)
//        ↓
//    ① FrameSnapshot.captureFrameSnapshot()
//        ↓
//    ② ShadowRenderer.render(snapshot)
//        ↓
//    ③ RenderDiffEngine.compute(snapshot, shadowOutput)
//        ↓
//    ④ onDiff callback (if registered)
//
//  约束：
//  ❌ 不修改 CanvasSession 任何属性
//  ❌ 不调用 CanvasSession 的任何 setter
//  ❌ 不持有 CanvasSession 的长期引用（每次 observe 传入）
//  ❌ 不注册 window/dom listener
//  ✅ 纯旁路 — 读 → 算 → 报告
// ============================================================

import { captureFrameSnapshot, type FrameSnapshot } from './FrameSnapshot';
import { ShadowRenderer, type ShadowRenderOutput } from './ShadowRenderer';
import { RenderDiffEngine, type RenderDiffResult } from './RenderDiffEngine';

// ============================================================
//  Types
// ============================================================

/** observe() 的输入 — CanvasSession 的只读视图 */
export interface ObserveInput {
  /** engine.strokes */
  strokes: ReadonlyArray<{
    id: string;
    points?: readonly { x: number; y: number }[];
    color?: string;
    width?: number;
    _penParams?: {
      spacing?: number;
      smoothness?: number;
      strokeWidth?: number;
      cornerKeep?: number;
    };
  }>;
  /** inputSnapshot.previewStroke */
  previewStroke: {
    id: string;
    points?: readonly { x: number; y: number }[];
    color?: string;
    width?: number;
    _penParams?: {
      spacing?: number;
      smoothness?: number;
      strokeWidth?: number;
      cornerKeep?: number;
    };
  } | null;
  /** viewport.camera */
  camera: { x: number; y: number; zoom: number };
  /** engine.params */
  brushParams: {
    spacing: number;
    smoothness: number;
    strokeWidth: number;
    cornerKeep: number;
  };
}

/** 一帧的完整观察记录 */
export interface ObserveRecord {
  /** 捕获的时间戳 */
  timestamp: number;
  /** 冻结快照 */
  snapshot: FrameSnapshot;
  /** shadow 渲染输出（可能为 null = shadow renderer disabled） */
  shadowOutput: ShadowRenderOutput | null;
  /** diff 结果（可能为 null = diff engine disabled） */
  diff: RenderDiffResult | null;
  /** observe() 总耗时 (ms) */
  totalTimeMs: number;
  /** 是否 diff clean */
  isClean: boolean | null;
}

/** 历史记录配置 */
export interface ObserverConfig {
  /** 是否启用 (默认 false) */
  enabled?: boolean;
  /** 是否启用 shadow renderer */
  shadowEnabled?: boolean;
  /** 是否启用 diff engine */
  diffEnabled?: boolean;
  /** 历史记录最大帧数 (默认 60) */
  historySize?: number;
  /** debug 日志 */
  debug?: boolean;
}

// ============================================================
//  Constants
// ============================================================

const DEFAULT_CONFIG: Required<ObserverConfig> = {
  enabled: false,
  shadowEnabled: false,
  diffEnabled: false,
  historySize: 60,
  debug: false,
};

// ============================================================
//  ShadowRenderObserver
// ============================================================

export class ShadowRenderObserver {
  // ── Subsystems ──
  private _shadowRenderer: ShadowRenderer;
  private _diffEngine: RenderDiffEngine;

  // ── Config ──
  private _config: Required<ObserverConfig>;
  private _enabled: boolean;

  // ── History ──
  private _history: ObserveRecord[] = [];
  private _totalFrames = 0;

  // ── Callbacks ──
  private _onDiff: ((diff: RenderDiffResult) => void) | null = null;
  private _onRecord: ((record: ObserveRecord) => void) | null = null;
  private _onError: ((err: Error, context: string) => void) | null = null;

  constructor(config: ObserverConfig = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._enabled = this._config.enabled;

    this._shadowRenderer = new ShadowRenderer({
      enabled: this._config.shadowEnabled,
      debug: this._config.debug,
    });

    this._diffEngine = new RenderDiffEngine();
    if (this._config.diffEnabled) {
      this._diffEngine.enable();
    }
    this._diffEngine.setDebug(this._config.debug);
  }

  // ==========================================================
  //  Lifecycle
  // ==========================================================

  /** 启用整个观察系统 */
  enable(): void {
    if (this._enabled) return;
    this._enabled = true;

    if (this._config.shadowEnabled) {
      this._shadowRenderer.enable();
    }
    if (this._config.diffEnabled) {
      this._diffEngine.enable();
    }

    if (this._config.debug) {
      console.log('[ShadowObserver] ✅ enabled', {
        shadow: this._config.shadowEnabled,
        diff: this._config.diffEnabled,
      });
    }
  }

  /** 禁用整个观察系统 + 释放资源 */
  disable(): void {
    this._enabled = false;
    this._shadowRenderer.disable();
    this._diffEngine.disable();
    this._history = [];

    if (this._config.debug) {
      console.log('[ShadowObserver] ⏹ disabled — resources released');
    }
  }

  get enabled(): boolean { return this._enabled; }

  // ==========================================================
  //  Callbacks
  // ==========================================================

  /** 每帧 diff 完成后的回调 */
  onDiff(fn: (diff: RenderDiffResult) => void): void {
    this._onDiff = fn;
  }

  /** 每帧完整记录的回调（含 snapshot + shadow output + diff） */
  onRecord(fn: (record: ObserveRecord) => void): void {
    this._onRecord = fn;
  }

  /** 错误回调 */
  onError(fn: (err: Error, context: string) => void): void {
    this._onError = fn;
  }

  // ==========================================================
  //  observe() — 唯一入口（从 main.ts _unifiedTick 调用）
  // ==========================================================

  /**
   * 观察一帧渲染。
   *
   * 调用位置：main.ts CanvasSession._unifiedTick() 中 renderFrame() 之后。
   *
   * 调用方式：
   *   shadowObserver.observe({
   *     strokes: this.engine.strokes,
   *     previewStroke: this.inputSnapshot.previewStroke,
   *     camera: this.viewport.camera,
   *     brushParams: this.engine.params,
   *   });
   *
   * 🔒 所有子系统异常被 try/catch 隔离，不会向上抛异常。
   *
   * @param input CanvasSession 的只读状态视图
   * @returns ObserveRecord | null（disabled 时返回 null）
   */
  observe(input: ObserveInput): ObserveRecord | null {
    if (!this._enabled) return null;

    const t0 = performance.now();
    const record: ObserveRecord = {
      timestamp: t0,
      snapshot: null as unknown as FrameSnapshot,
      shadowOutput: null,
      diff: null,
      totalTimeMs: 0,
      isClean: null,
    };

    // ── Phase 1: Snapshot ──
    try {
      record.snapshot = captureFrameSnapshot(input);
    } catch (err) {
      this._handleError(err, 'snapshot');
      record.totalTimeMs = performance.now() - t0;
      this._pushHistory(record);
      return record;
    }

    // ── Phase 2: Shadow Render ──
    if (this._shadowRenderer.enabled) {
      try {
        record.shadowOutput = this._shadowRenderer.render(record.snapshot);
      } catch (err) {
        this._handleError(err, 'shadow-render');
      }
    }

    // ── Phase 3: Diff ──
    if (this._diffEngine.enabled && record.shadowOutput) {
      try {
        record.diff = this._diffEngine.compute(
          record.snapshot,
          record.shadowOutput,
        );
        record.isClean = record.diff.isClean;

        // 通知 diff 回调
        if (this._onDiff && record.diff) {
          try { this._onDiff(record.diff); } catch { /* silent */ }
        }
      } catch (err) {
        this._handleError(err, 'diff');
      }
    }

    // ── Finalize ──
    record.totalTimeMs = performance.now() - t0;
    this._totalFrames++;

    this._pushHistory(record);

    // 通知 record 回调
    if (this._onRecord) {
      try { this._onRecord(record); } catch { /* silent */ }
    }

    if (this._config.debug && this._totalFrames % 60 === 0) {
      console.log('[ShadowObserver] 📊 stats:', {
        totalFrames: this._totalFrames,
        historySize: this._history.length,
        avgTimeMs: (this._history.reduce((s, r) => s + r.totalTimeMs, 0) / this._history.length).toFixed(2),
        lastDiffClean: record.isClean,
      });
    }

    return record;
  }

  // ==========================================================
  //  Query
  // ==========================================================

  /** 获取历史记录 */
  getHistory(): readonly ObserveRecord[] {
    return this._history;
  }

  /** 获取最近一条记录 */
  getLastRecord(): ObserveRecord | null {
    return this._history.length > 0
      ? this._history[this._history.length - 1]
      : null;
  }

  /** 获取总帧数 */
  get totalFrames(): number {
    return this._totalFrames;
  }

  /** 获取最近 N 条 diff 结果 */
  getRecentDiffs(n: number = 10): RenderDiffResult[] {
    return this._history
      .slice(-n)
      .filter(r => r.diff !== null)
      .map(r => r.diff!);
  }

  /** 清空历史 */
  clearHistory(): void {
    this._history = [];
  }

  /** 是否所有最近的帧 diff clean */
  isStable(windowSize: number = 30): boolean {
    const recent = this._history.slice(-windowSize);
    if (recent.length === 0) return false;
    return recent.every(r => r.isClean === true);
  }

  // ==========================================================
  //  Accessors — 暴露子系统供外部直接使用
  // ==========================================================

  get shadowRenderer(): ShadowRenderer { return this._shadowRenderer; }
  get diffEngine(): RenderDiffEngine { return this._diffEngine; }

  // ==========================================================
  //  Private
  // ==========================================================

  private _pushHistory(record: ObserveRecord): void {
    this._history.push(record);
    // 环形裁剪
    while (this._history.length > this._config.historySize) {
      this._history.shift();
    }
  }

  private _handleError(err: unknown, context: string): void {
    const error = err instanceof Error ? err : new Error(String(err));
    if (this._config.debug) {
      console.error(`[ShadowObserver] ❌ ${context}:`, error.message);
    }
    if (this._onError) {
      try { this._onError(error, context); } catch { /* silent */ }
    }
  }
}

// ============================================================
//  Global singleton (optional — 调用方可自行管理实例)
// ============================================================

export const globalShadowObserver = new ShadowRenderObserver();

export default ShadowRenderObserver;
