// ============================================================
//  Phase 5.4: Render Command Stream — Single Source Unification
//
//  核心原则：
//  🎯 所有"画的东西"，必须来自同一个 stream
//
//  唯一合法路径：
//    pointer → RenderCommandStream → renderFrame → StampBuffer → draw
//
//  职责：
//  ✔ 唯一渲染输入源（替代 submissionQueue + _stamps 多源）
//  ✔ input ≠ render（完全解耦）
//  ✔ render ≠ state mutation（stream only）
//
//  收益：
//  ✔ SSOT 完成 — input/stream/render/buffer/derive 层次清晰
//  ✔ GPU-ready — command stream → instance buffer 直接映射
//  ✔ 删除多源同步问题 — 不再有 queue/buffer/stamps 混用
//
//  约束：
//  ❌ addPoint 不写任何 buffer
//  ❌ renderFrame 不写任何 input state
//  ❌ stamps 不参与渲染逻辑（仅持久化）
//  ❌ queue / buffer 不混用
// ============================================================

// ============================================================
//  Types
// ============================================================

/** 唯一合法渲染单位 — 所有视觉输出都来自此类型 */
export interface RenderCommand {
  x: number;
  y: number;

  /** 🟢 Phase 5.5: GPU-ready raw inputs — inkW/opacity 降级为可计算值 */
  /** 规范化压力 0~1 */
  pressure: number;
  /** 规范化速度 px/ms（已平滑） */
  velocity: number;
  /** 距笔触起点的累积距离（世界坐标 px） */
  t: number;
  /** 🟢 Phase 5.5.1: 笔触总长度（用于收笔淡出）。0 = 未知（实时绘制中） */
  totalLen: number;
  /** 笔刷 ID — GPU shader 一致性保证 */
  brushId: string;
  /** Packed RGBA color */
  color: number;
  /** Deterministic seed */
  seed: number;
  /** 0 = stroke（已完成笔触）, 1 = preview（实时预览） */
  type: 0 | 1;
}

// ============================================================
//  Constants
// ============================================================

/** 默认最大队列大小 */
const DEFAULT_MAX_SIZE = 100000;

/** soft eviction 时丢弃的条目数 */
const SOFT_EVICT_COUNT = 5000;

/** 默认每次 drain 的批量大小 */
const DEFAULT_BATCH_SIZE = 4096;

// ============================================================
//  RenderCommandStream — 唯一渲染命令流
// ============================================================

export class RenderCommandStream {
  /** 内部队列 — 先进先出 */
  private queue: RenderCommand[] = [];
  /** 队列容量上限 */
  private maxSize: number;

  /**
   * @param maxSize 队列容量上限，默认 100000
   */
  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
  }

  /**
   * 推送渲染命令到流中。
   *
   * 当队列超过 maxSize 时，soft evict 最旧的 5000 条
   *（防止内存爆炸，同时保留最新数据）。
   *
   * 这是 addPoint 唯一允许的写操作。
   *
   * @param cmd 渲染命令
   */
  push(cmd: RenderCommand): void {
    this.queue.push(cmd);

    if (this.queue.length > this.maxSize) {
      // soft eviction: 丢弃最旧的一批
      this.queue.splice(0, SOFT_EVICT_COUNT);
    }
  }

  /**
   * 批量推送渲染命令。
   *
   * @param cmds 渲染命令数组
   */
  pushBatch(cmds: readonly RenderCommand[]): void {
    for (let i = 0; i < cmds.length; i++) {
      this.push(cmds[i]);
    }
  }

  /**
   * 从流中取出最多 n 条命令。
   * 取出的命令从流中移除。
   *
   * 这是 renderFrame 唯一允许的读操作。
   *
   * @param n 单次取出数量，默认 4096
   * @returns 取出的命令数组（可能少于 n）
   */
  drain(n: number = DEFAULT_BATCH_SIZE): RenderCommand[] {
    if (this.queue.length === 0) return [];
    return this.queue.splice(0, Math.min(n, this.queue.length));
  }

  /**
   * 清空流。用于页面切换、重置等场景。
   */
  clear(): void {
    this.queue.length = 0;
  }

  /** 当前流中的命令数量 */
  get size(): number {
    return this.queue.length;
  }

  /** 流是否为空 */
  get isEmpty(): boolean {
    return this.queue.length === 0;
  }
}

/** 全局单例 — 唯一渲染命令流实例 */
export const renderCommandStream = new RenderCommandStream();
