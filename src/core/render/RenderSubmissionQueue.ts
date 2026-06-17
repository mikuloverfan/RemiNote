// ============================================================
//  Phase 5.3: Render Submission Queue — Frame Decoupling
//
//  核心职责：
//  🎯 输入和渲染完全解耦
//  🎯 渲染只消费"批量提交数据"
//  🎯 pointermove 永远不触发 render
//
//  唯一合法路径：
//    addPoint → queue
//    renderFrame → drain → buffer → draw
//
//  收益：
//  ✔ pointer input 不阻塞 render
//  ✔ renderFrame 不影响 input
//  ✔ brush kernel 完全独立
//  ✔ burst protection — 快速滑动自动吸收
//  ✔ 延迟稳定 — 输入不依赖 frame rate
//
//  约束：
//  ❌ addPoint 不允许写 buffer
//  ❌ renderFrame 不允许处理 pointer
//  ❌ brush kernel 不参与 queue 逻辑
//  ❌ 不允许同步渲染
// ============================================================

// ============================================================
//  Types
// ============================================================

/** 单个 stamp 的提交命令 — 原始数据，不做渲染计算 */
export interface StampCommand {
  x: number;
  y: number;
  /** ink width — renderFrame 中用于计算 radius = inkW * 0.4 */
  inkW: number;
  opacity: number;
  /** Packed RGBA color */
  color: number;
  /** Deterministic seed */
  seed: number;
}

// ============================================================
//  Constants
// ============================================================

/** 默认最大队列大小 */
const DEFAULT_MAX_SIZE = 50000;

/** soft drop 时丢弃的条目数 */
const SOFT_DROP_COUNT = 1000;

/** 默认每次 drain 的批量大小 */
const DEFAULT_BATCH_SIZE = 2048;

// ============================================================
//  RenderSubmissionQueue
// ============================================================

export class RenderSubmissionQueue {
  /** 内部队列 — 先进先出 */
  private queue: StampCommand[] = [];
  /** 队列容量上限 */
  private maxSize: number;

  /**
   * @param maxSize 队列容量上限，默认 50000
   */
  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
  }

  /**
   * 提交一个 stamp 命令到队列。
   *
   * 当队列超过 maxSize 时，丢弃最旧的 SOFT_DROP_COUNT 条
   *（soft drop — 防止内存爆炸，同时保留最新数据）。
   *
   * @param cmd stamp 命令
   */
  push(cmd: StampCommand): void {
    this.queue.push(cmd);

    if (this.queue.length > this.maxSize) {
      // soft drop: 丢弃最旧的一批，保留最新数据
      this.queue.splice(0, SOFT_DROP_COUNT);
    }
  }

  /**
   * 批量提交 stamp 命令（避免多次 push 调用开销）。
   *
   * @param cmds stamp 命令数组
   */
  pushBatch(cmds: readonly StampCommand[]): void {
    for (let i = 0; i < cmds.length; i++) {
      this.push(cmds[i]);
    }
  }

  /**
   * 从队列中取出最多 batchSize 条命令。
   * 取出的命令从队列中移除。
   *
   * @param batchSize 单次取出数量，默认 2048
   * @returns 取出的命令数组（可能少于 batchSize）
   */
  drain(batchSize: number = DEFAULT_BATCH_SIZE): StampCommand[] {
    if (this.queue.length === 0) return [];
    return this.queue.splice(0, Math.min(batchSize, this.queue.length));
  }

  /**
   * 清空队列。用于页面切换、重置等场景。
   */
  clear(): void {
    this.queue.length = 0;
  }

  /** 当前队列中的命令数量 */
  get size(): number {
    return this.queue.length;
  }

  /** 队列是否为空 */
  get isEmpty(): boolean {
    return this.queue.length === 0;
  }
}

/** 全局单例 — 唯一提交队列实例 */
export const submissionQueue = new RenderSubmissionQueue();
