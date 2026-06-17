// ============================================================
//  SVS Diff Stabilizer — 去噪 + 统计稳定性
//
//  问题：
//  单帧 diff 噪声大：mid-frame mutation、浮点精度、canvas 差异
//  → 单帧 isClean=false 不说明任何问题
//
//  方案：
//  ① 滑动窗口 (默认 10 帧)
//  ② 稳定判定: 8/10 clean → stable
//  ③ 趋势追踪: 连续 N 帧不 clean → 告警
//  ④ 统计聚合: 累积统计而非单帧判断
//
//  约束：
//  ❌ 不修改 RenderDiffResult 结构
//  ❌ 不修改 RenderDiffEngine
//  ✅ 纯后处理层 — 消费 diff 输出
// ============================================================

import type { RenderDiffResult } from './RenderDiffEngine';

// ============================================================
//  Types
// ============================================================

/** DiffStabilizer 配置 */
export interface DiffStabilizerConfig {
  /** 滑动窗口大小 (帧数, 默认 10) */
  windowSize?: number;
  /** 稳定阈值 — clean 帧占比需 ≥ 此值才判定为 stable (默认 0.8) */
  stabilityThreshold?: number;
  /** 告警阈值 — 连续不 clean 帧数 ≥ 此值时触发 (默认 5) */
  alertThreshold?: number;
  /** debug 日志 */
  debug?: boolean;
}

/** 稳定性状态 */
export type StabilityState = 'stable' | 'unstable' | 'degrading' | 'alert';

/** 完整的稳定性报告 */
export interface StabilityReport {
  /** 当前状态 */
  state: StabilityState;
  /** 窗口内的 clean 帧数 */
  cleanFrames: number;
  /** 窗口内的总帧数 */
  totalFrames: number;
  /** clean 比例 (0~1) */
  cleanRatio: number;
  /** 当前连续不 clean 帧数 */
  consecutiveUnclean: number;
  /** 窗口内累积的 diff 统计 */
  stats: DiffStatistics;
  /** 最近一次 diff */
  lastDiff: RenderDiffResult | null;
  /** 稳定窗口首次变得 clean 的帧 ID */
  stableSince: number | null;
}

/** 累积 diff 统计 */
export interface DiffStatistics {
  /** 累计 missing strokes */
  totalMissing: number;
  /** 累计 extra strokes */
  totalExtra: number;
  /** 累计 bbox 不匹配 */
  totalBBoxMismatch: number;
  /** 累计渲染顺序不匹配 */
  totalOrderMismatch: number;
  /** 累计帧漂移 */
  totalFrameDrift: number;
  /** 窗口内 diff 帧数 */
  framesAnalyzed: number;
}

// ============================================================
//  Constants
// ============================================================

const DEFAULT_CONFIG: Required<DiffStabilizerConfig> = {
  windowSize: 10,
  stabilityThreshold: 0.8,
  alertThreshold: 5,
  debug: false,
};

// ============================================================
//  SVSDiffStabilizer
// ============================================================

export class SVSDiffStabilizer {
  // ── Config ──
  private _config: Required<DiffStabilizerConfig>;
  private _enabled = false;

  // ── State ──
  private _window: RenderDiffResult[] = [];
  private _consecutiveUnclean = 0;
  private _stableSince: number | null = null;
  private _currentState: StabilityState = 'unstable';

  // ── Cumulative stats ──
  private _stats: DiffStatistics = {
    totalMissing: 0,
    totalExtra: 0,
    totalBBoxMismatch: 0,
    totalOrderMismatch: 0,
    totalFrameDrift: 0,
    framesAnalyzed: 0,
  };

  constructor(config: DiffStabilizerConfig = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==========================================================
  //  Lifecycle
  // ==========================================================

  enable(): void { this._enabled = true; }
  disable(): void {
    this._enabled = false;
    this._reset();
  }
  get enabled(): boolean { return this._enabled; }

  // ==========================================================
  //  add — 每帧投喂 diff 结果
  // ==========================================================

  /**
   * 投喂一帧的 diff 结果。
   *
   * 调用时机：ShadowRenderObserver 中 diff 完成后。
   *
   * 内部逻辑：
   * 1. 推入滑动窗口
   * 2. 更新连续不 clean 计数
   * 3. 更新累积统计
   * 4. 重新计算稳定性状态
   *
   * @param diff RenderDiffEngine.compute() 的输出
   */
  add(diff: RenderDiffResult): void {
    if (!this._enabled) return;

    // ── 1. 推入窗口 ──
    this._window.push(diff);
    while (this._window.length > this._config.windowSize) {
      // 移除最旧帧时调整统计
      const removed = this._window.shift()!;
      this._subtractStats(removed);
    }

    // ── 2. 连续不 clean 计数 ──
    if (diff.isClean) {
      this._consecutiveUnclean = 0;
      if (this._stableSince === null) {
        this._stableSince = diff.frameId;
      }
    } else {
      this._consecutiveUnclean++;
      this._stableSince = null;
    }

    // ── 3. 累积统计 ──
    this._addStats(diff);

    // ── 4. 稳定性判定 ──
    this._currentState = this._computeState();

    if (this._config.debug && !diff.isClean) {
      console.log('[SVSDiffStabilizer] 🔍 diff added:', {
        frameId: diff.frameId,
        isClean: diff.isClean,
        state: this._currentState,
        consecutiveUnclean: this._consecutiveUnclean,
        cleanRatio: this._cleanRatio(),
      });
    }
  }

  // ==========================================================
  //  Query
  // ==========================================================

  /** 当前是否稳定（8/10 clean） */
  isStable(): boolean {
    return this._currentState === 'stable';
  }

  /** 获取完整稳定性报告 */
  getReport(): StabilityReport {
    return {
      state: this._currentState,
      cleanFrames: this._cleanFrames(),
      totalFrames: this._window.length,
      cleanRatio: this._cleanRatio(),
      consecutiveUnclean: this._consecutiveUnclean,
      stats: { ...this._stats },
      lastDiff: this._window.length > 0
        ? this._window[this._window.length - 1]
        : null,
      stableSince: this._stableSince,
    };
  }

  /** 获取累积统计 */
  getStats(): Readonly<DiffStatistics> {
    return { ...this._stats };
  }

  /** 窗口大小 */
  get windowSize(): number {
    return this._window.length;
  }

  /** 当前状态 */
  get state(): StabilityState {
    return this._currentState;
  }

  // ==========================================================
  //  Private: 稳定性计算
  // ==========================================================

  private _cleanFrames(): number {
    return this._window.filter(d => d.isClean).length;
  }

  private _cleanRatio(): number {
    // 🟦 Empty window = no data = assume healthy (avoid false FAIL cascade)
    if (this._window.length === 0) return 1;
    return this._cleanFrames() / this._window.length;
  }

  private _computeState(): StabilityState {
    if (this._window.length === 0) return 'unstable';

    const ratio = this._cleanRatio();
    const threshold = this._config.stabilityThreshold;

    // Alert: 连续不 clean 超过阈值
    if (this._consecutiveUnclean >= this._config.alertThreshold) {
      return 'alert';
    }

    // Stable: 窗口内 clean 比例 ≥ 阈值
    if (this._window.length >= this._config.windowSize && ratio >= threshold) {
      return 'stable';
    }

    // Degrading: 窗口满但未达稳定阈值
    if (this._window.length >= this._config.windowSize && ratio < threshold) {
      return 'degrading';
    }

    // Unstable: 窗口未满或刚刚 reset
    return 'unstable';
  }

  // ==========================================================
  //  Private: 统计累积
  // ==========================================================

  private _addStats(diff: RenderDiffResult): void {
    this._stats.totalMissing += diff.missingStrokes.length;
    this._stats.totalExtra += diff.extraStrokes.length;
    this._stats.totalBBoxMismatch += diff.bboxMismatches.length;
    this._stats.totalOrderMismatch += diff.renderOrderMismatches.length;
    this._stats.totalFrameDrift += diff.frameDrift;
    this._stats.framesAnalyzed++;
  }

  private _subtractStats(diff: RenderDiffResult): void {
    this._stats.totalMissing -= diff.missingStrokes.length;
    this._stats.totalExtra -= diff.extraStrokes.length;
    this._stats.totalBBoxMismatch -= diff.bboxMismatches.length;
    this._stats.totalOrderMismatch -= diff.renderOrderMismatches.length;
    this._stats.totalFrameDrift -= diff.frameDrift;
    this._stats.framesAnalyzed = Math.max(0, this._stats.framesAnalyzed - 1);
  }

  // ==========================================================
  //  Private: reset
  // ==========================================================

  private _reset(): void {
    this._window = [];
    this._consecutiveUnclean = 0;
    this._stableSince = null;
    this._currentState = 'unstable';
    this._stats = {
      totalMissing: 0,
      totalExtra: 0,
      totalBBoxMismatch: 0,
      totalOrderMismatch: 0,
      totalFrameDrift: 0,
      framesAnalyzed: 0,
    };
  }
}

export default SVSDiffStabilizer;
